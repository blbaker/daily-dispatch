"""Verify a generated podcast: transcribe (tiny.en, fast) and diff against the script.
Usage: podcast_verify.py SCRIPT_DIR AUDIO.mp3 OUT_DIR
Reports: word-match ratio, audio tags read aloud as words, missing script spans.

Requires faster-whisper (not a hard dependency of the rest of the pipeline --
install it only when you want to verify a real recording):
    pip install faster-whisper
"""
import difflib, glob, json, re, sys, time
from faster_whisper import WhisperModel

sdir, audio, odir = sys.argv[1:4]
t = time.time()
m = WhisperModel("tiny.en", device="cpu", compute_type="int8", cpu_threads=20)
segs, _ = m.transcribe(audio, beam_size=1, vad_filter=False)
out = []
with open(f"{odir}/whisper.jsonl", "w") as f:
    for s in segs:
        out.append((round(s.start, 1), s.text.strip()))
        f.write(json.dumps(out[-1]) + "\n")
print("transcribed", len(out), "segments in", round(time.time() - t), "s")

heard = " ".join(x for _, x in out).lower()
lines = [l.split(":", 1)[1] for fn in sorted(glob.glob(f"{sdir}/*.txt"))
         for l in open(fn) if re.match(r"^[A-Z0-9_]+:", l)]
tags = sorted({t.lower() for l in lines for t in re.findall(r"\[([^\]]+)\]", l)})
script = " ".join(re.sub(r"\[[^\]]*\]", "", l) for l in lines)
tok = lambda s: re.findall(r"[a-z0-9']+", s.lower())
a, b = tok(script), tok(heard)
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
blocks = sm.get_matching_blocks()
print("script words", len(a), "heard words", len(b),
      "match", round(sum(x.size for x in blocks) / len(a), 3))
spoken = {t: heard.count(t) for t in tags if heard.count(t)}
print("audio tags read aloud as words:", spoken or "none")
gaps = []
for p, q in zip(blocks, blocks[1:]):
    g = q.a - (p.a + p.size)
    if g > 15:
        gaps.append((g, " ".join(a[p.a + p.size:q.a])[:150]))
for g in sorted(gaps, reverse=True)[:6]:
    print("GAP", g)
