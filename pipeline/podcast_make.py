#!/usr/bin/env python3
"""Two-host (+ callers) podcast from a tagged script, voiced with ElevenLabs Text-to-Dialogue.

Adapted from bytedance/deer-flow `podcast-generation` (script -> TTS -> mix -> transcript)
onto ElevenLabs /v1/text-to-dialogue so turns keep conversational timing and audio tags.

Script format (one or more .txt files, read in name order):
    ## Segment title            <- starts a new segment (longer pause, never split across)
    S1: [laughing] Line text    <- TAG: text ; TAG must exist in the voices map

Usage:
    podcast_make.py --script-dir DIR --voices voices.json --out ep.mp3 [--transcript ep.md]
                    [--model eleven_v4] [--stability 0.5] [--workers 3] [--dry-run]
voices.json: {"S1": {"id": "...", "name": "Speaker 1"}, ...} -- see voices.example.json.
Key: env var ELEVENLABS_API_KEY (or XI).
Chunks are cached by content hash in <out>.chunks/, so edits only re-voice changed chunks.

--dry-run never calls the ElevenLabs API: it parses the script, writes the
transcript, and prints the estimated character count and runtime, so you can
verify a script is well-formed without spending any credits.
"""
import argparse, concurrent.futures as cf, hashlib, json, os, re, subprocess, sys, time
import urllib.error, urllib.request

API = "https://api.elevenlabs.io"
LINE = re.compile(r"^([A-Z0-9_]+):\s*(.+)$")


def api_key():
    k = os.environ.get("ELEVENLABS_API_KEY") or os.environ.get("XI")
    if not k:
        sys.exit("ELEVENLABS_API_KEY (or XI) is not set. Get a key at "
                 "https://elevenlabs.io/app/settings/api-keys and export it.")
    return k.strip()


def parse(script_dir, voices):
    segs, cur = [], None
    for fn in sorted(f for f in os.listdir(script_dir) if f.endswith(".txt")):
        for raw in open(os.path.join(script_dir, fn), encoding="utf-8"):
            s = raw.strip()
            if not s:
                continue
            if s.startswith("## "):
                cur = {"title": s[3:].strip(), "lines": []}
                segs.append(cur)
                continue
            m = LINE.match(s)
            if not m or m.group(1) not in voices:
                sys.exit(f"bad line in {fn}: {s[:80]}")
            # The API 400s on a turn that is ONLY audio tags ("S2: [laughs]").
            if not re.sub(r"\[[^\]]*\]", "", m.group(2)).strip():
                sys.exit(f"tag-only line in {fn} (add words): {s[:80]}")
            if cur is None:
                cur = {"title": "Intro", "lines": []}
                segs.append(cur)
            cur["lines"].append((m.group(1), m.group(2)))
    return segs


def chunk(segs, max_chars):
    chunks = []
    for si, seg in enumerate(segs):
        buf, n = [], 0
        for tag, text in seg["lines"]:
            if buf and n + len(text) > max_chars:
                chunks.append({"seg": si, "lines": buf})
                buf, n = [], 0
            buf.append((tag, text))
            n += len(text)
        if buf:
            chunks.append({"seg": si, "lines": buf})
    for i, c in enumerate(chunks):
        c["i"] = i
        c["last_in_seg"] = i + 1 == len(chunks) or chunks[i + 1]["seg"] != c["seg"]
    return chunks


def post(path, body, key, timeout=300):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"xi-api-key": key, "Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


def voice_chunk(c, voices, args, key, cdir):
    body = {"model_id": args.model, "settings": {"stability": args.stability},
            "inputs": [{"text": t, "voice_id": voices[tag]["id"]} for tag, t in c["lines"]]}
    if args.seed is not None:
        body["seed"] = args.seed
    h = hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()[:12]
    path = os.path.join(cdir, f"{c['i']:03d}-{h}.mp3")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return path, 0, "cached"
    for attempt in range(4):
        try:
            r = post("/v1/text-to-dialogue?output_format=mp3_44100_128", body, key)
            data = r.read()
            open(path, "wb").write(data)
            return path, int(r.headers.get("character-cost") or 0), "ok"
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode(errors="replace")
            # 409 already_running: two parallel requests both auto-adding the same
            # Voice Library voice to the account. Harmless; retry after a beat.
            if e.code in (409, 429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(5 * 2 ** attempt)
                continue
            raise RuntimeError(f"chunk {c['i']}: HTTP {e.code} {msg}")


def duration(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", p], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def assemble(chunks, out, gap, seg_gap):
    tmp = os.path.abspath(out + ".parts")  # concat resolves paths relative to list.txt
    os.makedirs(tmp, exist_ok=True)
    lst = []
    for kind, dur in (("gap", gap), ("seg", seg_gap)):
        p = os.path.join(tmp, f"{kind}.wav")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                        "anullsrc=r=44100:cl=mono", "-t", str(dur), p], check=True)
    for c in chunks:
        w = os.path.join(tmp, f"{c['i']:03d}.wav")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", c["path"], "-ac", "1",
                        "-ar", "44100", w], check=True)
        lst += [w, os.path.join(tmp, "seg.wav" if c["last_in_seg"] else "gap.wav")]
    txt = os.path.join(tmp, "list.txt")
    open(txt, "w").write("".join(f"file '{p}'\n" for p in lst[:-1]))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", txt,
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "44100",
                    "-c:a", "libmp3lame", "-b:a", "96k", out], check=True)


def transcript(segs, voices, title):
    md = [f"# {title}", ""]
    for seg in segs:
        md += [f"## {seg['title']}", ""]
        for tag, text in seg["lines"]:
            clean = re.sub(r"\s*\[[^\]]+\]\s*", " ", text).strip()
            if clean:
                md.append(f"**{voices[tag]['name']}:** {clean}  ")
        md.append("")
    return "\n".join(md)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script-dir", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--transcript")
    ap.add_argument("--title", default="Link Talk")
    ap.add_argument("--model", default="eleven_v4")
    ap.add_argument("--stability", type=float, default=0.5)
    ap.add_argument("--seed", type=int, default=1979)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--max-chars", type=int, default=1900)
    ap.add_argument("--gap", type=float, default=0.25)
    ap.add_argument("--seg-gap", type=float, default=0.8)
    ap.add_argument("--dry-run", action="store_true",
                    help="parse + write the transcript, print the char/minute estimate, "
                         "and stop before calling the ElevenLabs API or spending credits")
    a = ap.parse_args()

    voices = json.load(open(a.voices))
    segs = parse(a.script_dir, voices)
    chunks = chunk(segs, a.max_chars)
    total = sum(len(t) for c in chunks for _, t in c["lines"])
    print(f"segments={len(segs)} chunks={len(chunks)} chars={total} "
          f"est_minutes={total / 900:.0f}")
    if a.transcript:
        open(a.transcript, "w").write(transcript(segs, voices, a.title))
    if a.dry_run:
        return
    key = api_key()
    sub = json.load(urllib.request.urlopen(urllib.request.Request(
        API + "/v1/user/subscription", headers={"xi-api-key": key}), timeout=30))
    left = sub["character_limit"] - sub["character_count"]
    print(f"credits: {sub['character_count']}/{sub['character_limit']} used, {left} left")
    if total > left:
        sys.exit(f"ABORT: script needs up to {total} credits, only {left} left")

    cdir = a.out + ".chunks"
    os.makedirs(cdir, exist_ok=True)
    cost = 0
    with cf.ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(voice_chunk, c, voices, a, key, cdir): c for c in chunks}
        for f in cf.as_completed(futs):
            c = futs[f]
            c["path"], cc, st = f.result()
            cost += cc
            n = sum(len(t) for _, t in c["lines"])
            d = duration(c["path"])
            c["ratio"] = n / d if d else 0
            flag = "  <-- CHECK" if not 7 <= c["ratio"] <= 22 else ""
            print(f"chunk {c['i']:02d} {st:6s} chars={n:4d} dur={d:5.1f}s "
                  f"chars/s={c['ratio']:4.1f} cost={cc}{flag}", flush=True)
    assemble(chunks, a.out, a.gap, a.seg_gap)
    print(f"OUT {a.out} {duration(a.out) / 60:.1f} min, {os.path.getsize(a.out) / 1e6:.1f} MB, "
          f"character-cost total={cost}")


if __name__ == "__main__":
    main()
