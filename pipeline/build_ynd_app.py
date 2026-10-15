#!/usr/bin/env python3
"""Build the Yahoo News Digest-style ARCHIVE app from the day's digests.

Scans $DAILY_DISPATCH_WEB_DIR/link_digest_YYYYMMDD.html, parses each into an
edition (date, weekday, stories with category/headline/source/summary/url),
and emits ONE self-contained index.html:

  ARCHIVE (home)  -> every edition as a date-as-headline cover card, newest
                     first ("visit past ones")
  EDITION COVER   -> date hero + slanted lead-story card
  STORY LIST      -> that edition's stories as rows
  ARTICLE         -> white reading surface (prose summary, source link)
  COMPLETION      -> the "You've read X of Y" numbered-dots screen

Data-driven, so it regenerates every time a new digest lands.

Usage: build_ynd_app.py [WEB_DIR]   (default: $DAILY_DISPATCH_WEB_DIR)
Writes WEB_DIR/index.html

The UI (CSS/JS in the TEMPLATE string below) is a shipped design and is not
meant to be edited casually -- see CONTRIBUTING.md before changing it.
"""
import html
import json
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402

WEB_DIR = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else config.WEB_DIR

IMG_CACHE = config.IMG_CACHE
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def _load_img_cache():
    try:
        return json.loads(IMG_CACHE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_img_cache(c):
    try:
        IMG_CACHE.parent.mkdir(parents=True, exist_ok=True)
        IMG_CACHE.write_text(json.dumps(c, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def fetch_og_image(url, cache):
    """Resolve a story's hero image from its shared URL (og:image /
    twitter:image), cached by URL so rebuilds don't refetch. Returns '' if
    none. Follows redirects (share.google, google.com/url?q=)."""
    url = (url or "").strip()
    if not url:
        return ""
    if url in cache:
        return cache[url]
    img = ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read(300000).decode("utf-8", "replace")
        for pat in (
            r'<meta[^>]+property=["\']og:image(?::url)?["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
            r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
        ):
            m = re.search(pat, raw, re.I)
            if m:
                img = html.unescape(m.group(1).strip())
                break
        if img.startswith("//"):
            img = "https:" + img
    except Exception:
        img = ""
    cache[url] = img
    _save_img_cache(cache)
    return img


CATS = {
    "us": "#2B9FD9", "world": "#27AE60", "sports": "#F5A623",
    "science": "#9B4DCA", "entertainment": "#E74C8A", "tech": "#3498DB",
    "business": "#1ABC9C", "politics": "#E74C3C", "health": "#2ECC71",
}
CAT_LABEL = {
    "us": "U.S.", "world": "World", "sports": "Sports", "science": "Science",
    "entertainment": "Entertainment", "tech": "Technology",
    "business": "Business", "politics": "Politics", "health": "Health",
}
# keyword -> category, checked in order (first match wins)
CAT_RULES = [
    ("tech", r"\b(claude code|chrome extension|extension|api|sdk|github|open ?source|agent|codex|kubernetes|typescript|python|rust|npm|compiler|webassembly|wasm|manifest v3|framework|library|repo|cli)\b"),
    ("sports", r"\b(nba|nfl|cyclones|hawkeyes|cavs|game|season|coach|playoff|quarterback|raiders)\b"),
    ("science", r"\b(climate|research|study|space|nasa|physic|scien|model|quantum|gpu|qwen|opus)\b"),
    ("entertainment", r"\b(plex|tv|movie|show|film|music|stream|episode|television|netflix)\b"),
    ("business", r"\b(anthropic|openai|acqui|funding|revenue|market share|enterprise|ipo|startup|token load)\b"),
    ("world", r"\b(uae|climate|un |united nations|global|europe|china|ukraine)\b"),
    ("us", r"\b(senate|congress|obama|washington|u\.s\.|federal)\b"),
]


def infer_category(text):
    t = text.lower()
    for cat, pat in CAT_RULES:
        if re.search(pat, t):
            return cat
    return "tech"  # a dev-heavy feed defaults to tech; adjust CAT_RULES for your own feed


def parse_edition(path):
    m = re.search(r"link_digest_(\d{8})\.html$", path.name)
    if not m:
        return None
    try:
        d = datetime.strptime(m.group(1), "%Y%m%d")
    except ValueError:
        return None
    s = path.read_text(encoding="utf-8", errors="replace")

    # split into article blocks: from each <h2 ...> up to the next <h2 or footer
    blocks = re.split(r'(?=<h2\b)', s)
    stories = []
    for b in blocks:
        hm = re.search(r"<h2[^>]*>(.*?)</h2>", b, re.S)
        if not hm:
            continue
        headline = html.unescape(re.sub(r"<[^>]+>", "", hm.group(1)).strip())
        if not headline:
            continue
        bym = re.search(r"<em>(.*?)</em>", b, re.S)
        byline = html.unescape(re.sub(r"<[^>]+>", "", bym.group(1)).strip()) if bym else ""
        source = byline.split("\u2014")[0].split(",")[0].strip() or "Link"
        # source url
        um = re.search(r'<div class="source">\s*(?:<a[^>]*href="([^"]*)")?', b)
        url = (um.group(1) if um and um.group(1) else "").strip()
        # publish date (from the artdate div), drop the "Published " prefix
        am = re.search(r'<div class="artdate">\s*(.*?)\s*</div>', b, re.S)
        artdate = html.unescape(re.sub(r"<[^>]+>", "", am.group(1)).strip()) if am else ""
        artdate = re.sub(r"^Published\s+", "", artdate)
        # Quick-take summary points from the per-article overview box
        overview = []
        om = re.search(r'<div class="overview">(.*?)</div>', b, re.S)
        if om:
            for li in re.findall(r"<li>(.*?)</li>", om.group(1), re.S):
                lm = re.match(r"\s*<strong>(.*?)</strong>\s*(.*)", li, re.S)
                if lm:
                    label = html.unescape(re.sub(r"<[^>]+>", "", lm.group(1)).strip()).rstrip(":")
                    text = html.unescape(re.sub(r"<[^>]+>", "", lm.group(2)).strip())
                    overview.append({"label": label, "text": text})
                else:
                    txt = html.unescape(re.sub(r"<[^>]+>", "", li).strip())
                    if txt:
                        overview.append({"label": "", "text": txt})
        # body prose: strip overview/source/artdate divs and the italic byline para,
        # then keep EVERY remaining paragraph (full article, not a truncation)
        body_src = re.sub(r'<div class="overview">.*?</div>\s*', "", b, flags=re.S)
        body_src = re.sub(r'<div class="source">.*?</div>', "", body_src, flags=re.S)
        body_src = re.sub(r'<div class="artdate">.*?</div>', "", body_src, flags=re.S)
        body_src = re.sub(r'<p>\s*<em>.*?</em>\s*</p>', "", body_src, flags=re.S)
        paras = []
        for p in re.findall(r"<p>(.*?)</p>", body_src, re.S):
            txt = html.unescape(re.sub(r"<[^>]+>", "", p).strip())
            if txt and "min read" not in txt.lower():
                paras.append(txt)
        cat = infer_category(headline + " " + " ".join(paras[:1]) + " " + source)
        stories.append({
            "cat": cat, "headline": headline, "source": byline or source,
            "url": url, "date": artdate, "overview": overview, "body": paras,
            "image": "",
        })
    if not stories:
        return None
    return {
        "id": d.strftime("%Y-%m-%d"),
        "date": d.strftime("%B %-d"),
        "full": d.strftime("%A, %B %-d, %Y"),
        "weekday": d.strftime("%A").lower(),
        "stories": stories,
    }


def load_live_edition():
    """Build a provisional 'today, in progress' edition from the live link
    store so you can view links the moment you push them, before the daily
    digest turns them into full prose. Returns None if the store is empty or
    today's dated digest already exists."""
    store = config.LINK_STORE
    if not store.exists() or store.stat().st_size == 0:
        return None
    today = datetime.now()
    # If today's finished digest already exists, the dated edition covers it.
    if (WEB_DIR / f"link_digest_{today:%Y%m%d}.html").exists():
        return None
    stories = []
    for line in store.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        url = (rec.get("url") or "").strip()
        title = (rec.get("title") or "").strip()
        body = (rec.get("body") or "").strip()
        # Derive a readable headline: pushed title, else the URL's host/path.
        headline = title
        if not headline or headline.lower().startswith("source:"):
            hm = re.search(r"https?://([^/]+)(/[^?#]*)?", url)
            if hm:
                host = hm.group(1).replace("www.", "")
                slug = (hm.group(2) or "").strip("/").split("/")[-1].replace("-", " ").replace("_", " ")
                headline = (slug[:70].strip().capitalize() or host) if slug else host
            else:
                headline = title or url or "Saved link"
        hm = re.search(r"https?://([^/]+)", url)
        source = hm.group(1).replace("www.", "") if hm else "Link"
        cat = infer_category(headline + " " + body + " " + source)
        stories.append({
            "cat": cat, "headline": headline, "source": source,
            "url": url, "date": "", "overview": [], "body": [body] if body else [],
            "image": "",
        })
    if not stories:
        return None
    return {
        "id": today.strftime("%Y-%m-%d"),
        "date": today.strftime("%B %-d"),
        "full": today.strftime("%A, %B %-d, %Y"),
        "weekday": today.strftime("%A").lower(),
        "in_progress": True,
        "stories": stories,
    }


def build():
    files = sorted(WEB_DIR.glob("link_digest_*.html"))
    editions = [e for e in (parse_edition(f) for f in files) if e]
    live = load_live_edition()
    if live:
        editions.append(live)
    editions.sort(key=lambda e: e["id"], reverse=True)  # newest first

    # Resolve each story's hero image from its shared URL (cached by URL).
    img_cache = _load_img_cache()
    for ed in editions:
        for s in ed["stories"]:
            if not s.get("image"):
                s["image"] = fetch_og_image(s.get("url", ""), img_cache)

    data_js = json.dumps(editions, ensure_ascii=False)
    cats_js = json.dumps(CATS)
    labels_js = json.dumps(CAT_LABEL)
    updated = datetime.now().strftime("%b %-d, %Y")

    doc = TEMPLATE.replace("/*__DATA__*/", f"const EDITIONS={data_js};"
                           f"const CATS={cats_js};const LABELS={labels_js};"
                           f"const UPDATED={json.dumps(updated)};")
    out = WEB_DIR / "index.html"
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(doc, encoding="utf-8")
    print(f"{out}  ({out.stat().st_size//1024} KB, {len(editions)} edition(s))")
    _sync_api(editions)
    return 0


def _sync_api(editions):
    """Push each FINALIZED (dated) edition to the Daily Dispatch API exactly
    once. Marker-guarded so frequent link-push rebuilds don't re-scrape.
    Silent / best-effort: a failed sync never breaks the app build. The live
    'in progress' edition is skipped (it has no dated html yet). No-ops
    quietly if DIGEST_API_URL/DIGEST_API_KEY aren't configured."""
    import subprocess
    base, key = config.digest_api_conf()
    if not base or not key:
        return
    marker_dir = WEB_DIR / ".api-synced"
    marker_dir.mkdir(exist_ok=True)
    pusher = Path(__file__).resolve().parent / "push_to_api.py"
    for ed in editions:
        eid = ed.get("id")
        if not eid or ed.get("in_progress"):
            continue
        if not (WEB_DIR / f"link_digest_{eid.replace('-','')}.html").exists():
            continue
        marker = marker_dir / eid
        if marker.exists():
            continue
        try:
            r = subprocess.run(
                ["python3", str(pusher), "--date", eid],
                capture_output=True, text=True, timeout=300)
            if r.returncode == 0 and "200" in r.stdout:
                marker.write_text(datetime.now().isoformat())
                print(f"  api-sync {eid}: ok")
            else:
                print(f"  api-sync {eid}: FAILED {r.stdout.strip()[:80]}")
        except Exception as e:
            print(f"  api-sync {eid}: error {e}")

TEMPLATE = (Path(__file__).resolve().parent / "templates" / "archive_app.html").read_text(encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(build())
