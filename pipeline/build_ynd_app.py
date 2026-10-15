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


TEMPLATE = r"""<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#121212">
<title>The Daily Dispatch</title>
<style>
:root{
  --cover-bg:#121212;--article-bg:#fff;--panel:#1a1a1a;--nav:#0d0d0d;
  --text-dark:#fff;--text-light:#1a1a1a;--muted:#6b6b6b;--muted-dark:#9a9a9a;
  --divider:#ececec;--divider-dark:#2a2a2a;--accent:#2B9FD9;
  --font:'Proxima Nova','Avenir Next',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  --nav-h:0px;--tab-h:64px;--maxw:720px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:var(--font);-webkit-font-smoothing:antialiased;background:#000;color:var(--text-dark)}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}

/* ===== TOP NAV removed — navigation lives in the bottom tab bar on all sizes ===== */
.topnav{display:none}

/* ===== SHELL ===== */
.shell{max-width:var(--maxw);margin:0 auto;background:var(--cover-bg);min-height:calc(100vh - var(--tab-h));position:relative;padding-bottom:var(--tab-h)}
.view{display:none}
.view.active{display:block}

/* ===== TODAY: COVER ===== */
.cover{position:relative;min-height:calc(100vh - var(--tab-h));display:flex;flex-direction:column;overflow:hidden}
.cover-wash{position:absolute;inset:0;z-index:1}
.cover-overlay{position:absolute;inset:0;z-index:2;background:linear-gradient(to bottom,rgba(18,18,18,.25),rgba(18,18,18,.05) 32%,rgba(18,18,18,.55) 66%,rgba(18,18,18,.96))}
.cover-inner{position:relative;z-index:3;display:flex;flex-direction:column;flex:1;padding:32px 28px 0}
.cover-date{font-size:40px;font-weight:800;letter-spacing:-.02em;line-height:1}
.cover-dateline{font-size:15px;font-weight:300;opacity:.9;margin-top:6px;text-transform:lowercase}
.cover-spacer{flex:1;min-height:60px}
.cover-card{background:rgba(18,18,18,.94);margin:0 -28px;padding:34px 28px 40px;
  clip-path:polygon(0 24px,100% 0,100% 100%,0 100%);cursor:pointer;transition:.15s}
.cover-card:hover{background:rgba(28,28,28,.97)}
.cat{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.cat-dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff}
.cat-dot.sm{width:9px;height:9px;font-size:0}
.cat-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.09em}
.cover-headline{font-size:25px;font-weight:600;line-height:1.24;margin-bottom:10px}
.cover-source{font-size:12.5px;color:var(--muted-dark);line-height:1.4}
.cover-hint{display:flex;align-items:center;gap:6px;margin-top:18px;font-size:12px;color:var(--muted-dark)}
.cover-hint svg{width:14px;height:14px}

/* ===== STORY LIST ===== */
.list-wrap{padding-bottom:24px}
.subbar{display:flex;align-items:center;gap:14px;padding:20px 24px 12px}
.icon-btn{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  cursor:pointer;background:rgba(255,255,255,.07);color:#fff;flex:none}
.icon-btn:hover{background:rgba(255,255,255,.14)}
.icon-btn svg{width:19px;height:19px}
.subbar-title{font-size:16px;font-weight:700}
.subbar-sub{font-size:12px;color:var(--muted-dark);margin-top:1px}
.row{display:flex;gap:14px;align-items:flex-start;padding:18px 24px;border-bottom:1px solid var(--divider-dark);cursor:pointer;transition:.12s}
.row:hover{background:rgba(255,255,255,.04)}
.row-num{font-size:13px;font-weight:700;color:var(--muted);width:20px;flex:none;padding-top:2px}
.row-body{flex:1}
.row .cat{margin-bottom:6px}
.row-headline{font-size:17px;font-weight:600;line-height:1.34}
.row-read{font-size:11px;color:var(--accent);font-weight:700;margin-top:6px;display:none}
.row.read .row-read{display:block}
.row.read .row-headline{color:var(--muted-dark)}
.list-progress{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:18px 24px 8px}
.mini{display:flex;gap:5px}
.mini .d{width:9px;height:9px;border-radius:50%;opacity:.35}
.mini .d.on{opacity:1}
.progress-text{font-size:12.5px;color:var(--muted-dark)}

/* ===== ARTICLE (white reader) ===== */
.article{background:var(--article-bg);color:var(--text-light);min-height:calc(100vh - var(--tab-h))}
.a-top{position:sticky;top:0;z-index:20;background:var(--article-bg);display:flex;align-items:center;
  justify-content:space-between;padding:14px 24px;border-bottom:1px solid var(--divider)}
.a-top .icon-btn{background:#f2f2f2;color:var(--muted)}
.a-top .icon-btn:hover{background:#e6e6e6}
.a-count{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.04em}
.a-hero{aspect-ratio:16/9}
.a-inner{padding:26px 28px 40px}
.a-inner .cat{margin-bottom:12px}
.a-headline{font-size:28px;font-weight:700;line-height:1.2;letter-spacing:-.01em;margin-bottom:10px}
.a-meta{font-size:12.5px;color:var(--muted);margin-bottom:22px}
/* Quick take box */
.qt{background:#f5f9fc;border-left:3px solid var(--accent);border-radius:8px;padding:16px 18px;margin-bottom:24px}
.qt-h{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:10px}
.qt li{list-style:none;font-size:14.5px;line-height:1.5;margin-bottom:8px;padding-left:0}
.qt li:last-child{margin-bottom:0}
.qt b{font-weight:700}
.a-body p{font-size:16.5px;line-height:1.68;margin-bottom:18px;color:#252525}
.a-source{margin-top:26px;padding-top:18px;border-top:1px solid var(--divider);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.a-source .s-txt{font-size:12.5px;color:var(--muted)}
.a-source .s-link{font-size:13.5px;font-weight:700;color:var(--accent)}
.a-nav{display:flex;gap:12px;margin-top:28px}
.a-nav button{flex:1;padding:14px;border:1px solid var(--divider);background:#fff;border-radius:10px;
  font-family:var(--font);font-size:14px;font-weight:700;color:var(--text-light);cursor:pointer;transition:.12s}
.a-nav button:hover:not(:disabled){background:#f6f6f6}
.a-nav button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.a-nav button:disabled{opacity:.3;cursor:default}

/* ===== ARCHIVE ===== */
.archive{padding:8px 0 40px}
.arch-head{padding:22px 24px 6px}
.arch-title{font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--muted-dark)}
.arch-sub{font-size:12px;color:var(--muted);margin-top:3px}
.ed-card{position:relative;margin:14px 24px;border-radius:14px;overflow:hidden;min-height:180px;cursor:pointer;
  display:flex;flex-direction:column;justify-content:flex-end}
.ed-card:hover{transform:translateY(-2px)}
.ed-card{transition:transform .15s}
.ed-wash{position:absolute;inset:0;z-index:1}
.ed-body{position:relative;z-index:2;padding:22px;background:linear-gradient(0deg,rgba(0,0,0,.78),rgba(0,0,0,.12) 72%,transparent)}
.ed-date{font-size:34px;font-weight:800;letter-spacing:-.02em;line-height:.95}
.ed-dateline{font-size:12.5px;color:rgba(255,255,255,.85);text-transform:capitalize;margin-top:4px}
.ed-lead{font-size:15px;font-weight:600;line-height:1.3;margin-top:10px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ed-dots{display:flex;gap:5px;flex-wrap:wrap;margin-top:12px}
.ed-dots .d{width:9px;height:9px;border-radius:50%}
.badge{position:absolute;top:14px;right:14px;z-index:3;font-size:9px;font-weight:800;letter-spacing:.12em;padding:4px 9px;border-radius:20px}
.badge.latest{background:#fff;color:#121212}
.badge.live{background:#27AE60;color:#fff}

/* ===== BOTTOM TAB BAR (all viewports) ===== */
.tabbar{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:60;height:var(--tab-h);
  max-width:var(--maxw);margin:0 auto;background:var(--nav);border-top:1px solid var(--divider-dark);
  padding-bottom:env(safe-area-inset-bottom,0)}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  color:var(--muted-dark);cursor:pointer;font-size:10.5px;font-weight:700;letter-spacing:.03em;transition:.15s}
.tab:hover{color:#fff}
.tab svg{width:22px;height:22px}
.tab.active{color:var(--accent)}
.empty{color:var(--muted-dark);text-align:center;padding:90px 28px}

@media (max-width:640px){
  .a-headline{font-size:24px}
  .cover-date{font-size:36px}
}
@media (min-width:641px){
  .cover-card{border-radius:0 0 14px 14px}
  .cover{border-radius:0 0 14px 14px}
}
</style></head>
<body>
<div class="shell" id="shell"></div>
<nav class="tabbar">
  <div class="tab" data-tab="today" onclick="go('today')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
    Today</div>
  <div class="tab" data-tab="archive" onclick="go('archive')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>
    Archive</div>
</nav>
<script>
/*__DATA__*/
const shell=document.getElementById('app-shell')||document.getElementById('shell');
const WASHES=['#2B6CB0','#2C7A7B','#6B46C1','#B7791F','#9B2C5A','#2F855A','#1E6091'];
function shade(hex,amt){const h=hex.replace('#','');let r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);const t=amt<0?0:255,p=Math.abs(amt);r=Math.round((t-r)*p+r);g=Math.round((t-g)*p+g);b=Math.round((t-b)*p+b);return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');}
function wash(i){const c=WASHES[i%WASHES.length];return `linear-gradient(150deg,${shade(c,.18)},${shade(c,-.45)})`;}
/* hero background: real article image (darkened for legible text) over the gradient wash as fallback */
function bg(i,img){return img?`linear-gradient(rgba(18,18,18,.35),rgba(18,18,18,.35)),url('${String(img).replace(/'/g,"%27")}') center/cover no-repeat, ${WASHES[i%WASHES.length]}`:wash(i);}
function heroBg(i,img){return img?`url('${String(img).replace(/'/g,"%27")}') center/cover no-repeat, ${WASHES[i%WASHES.length]}`:wash(i);}
const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let read=JSON.parse(localStorage.getItem('yndRead')||'{}');
function saveRead(){localStorage.setItem('yndRead',JSON.stringify(read));}
function isRead(ed,i){return !!(read[ed]&&read[ed][i]);}
function markRead(ed,i){if(!read[ed])read[ed]={};read[ed][i]=true;saveRead();}
function readCount(ed){return read[ed]?Object.keys(read[ed]).length:0;}
const IB='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';
const IM='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
const IX='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';

let tab='today', curEd=EDITIONS[0]||null, curStory=0;

function setActive(t){document.querySelectorAll('[data-tab]').forEach(e=>e.classList.toggle('active',e.getAttribute('data-tab')===t));}
function go(t){tab=t;setActive(t);if(t==='today'){curEd=EDITIONS[0]||null;renderCover();}else renderArchive();window.scrollTo(0,0);}

function catDot(s,big){const c=CATS[s.cat]||CATS.tech;return `<div class="cat"><span class="cat-dot ${big?'':'sm'}" style="background:${c}">${big?'1':''}</span><span class="cat-label" style="color:${c}">${LABELS[s.cat]||'Technology'}</span></div>`;}

function renderCover(){
  if(!curEd){shell.innerHTML='<div class="empty">No digest yet. Editions appear here after the daily digest.</div>';return;}
  const ed=curEd,s=ed.stories[0],i=Math.max(0,EDITIONS.indexOf(ed));
  shell.innerHTML=`<div class="view active"><div class="cover">
    <div class="cover-wash" style="background:${bg(i,s.image)}"></div>
    <div class="cover-overlay"></div>
    <div class="cover-inner">
      <div><div class="cover-date">${esc(ed.date)}</div>
      <div class="cover-dateline">${esc(ed.weekday)} briefing${ed.in_progress?' · live':''}</div></div>
      <div class="cover-spacer"></div>
      <div class="cover-card" onclick="renderList()">
        ${catDot(s,true)}
        <h2 class="cover-headline">${esc(s.headline)}</h2>
        <p class="cover-source">${esc(s.source)}</p>
        <div class="cover-hint">${ed.stories.length} ${ed.stories.length===1?'story':'stories'} · tap to read
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>
      </div></div></div></div>`;
}

function renderList(){
  const ed=curEd,total=ed.stories.length,rc=readCount(ed.id);
  const rows=ed.stories.map((s,idx)=>`<div class="row ${isRead(ed.id,idx)?'read':''}" onclick="renderArticle(${idx})">
    <div class="row-num">${idx+1}</div><div class="row-body">${catDot(s)}
    <div class="row-headline">${esc(s.headline)}</div><div class="row-read">Read ✓</div></div></div>`).join('');
  const mini=ed.stories.map((s,idx)=>`<span class="d ${isRead(ed.id,idx)?'on':''}" style="background:${CATS[s.cat]||CATS.tech}"></span>`).join('');
  shell.innerHTML=`<div class="view active"><div class="list-wrap">
    <div class="subbar"><div class="icon-btn" onclick="renderCover()">${IB}</div>
      <div><div class="subbar-title">${esc(ed.date)}</div><div class="subbar-sub">${esc(ed.full||ed.weekday)}</div></div></div>
    ${rows}
    <div class="list-progress"><span class="progress-text">You've read</span>
      <div class="mini">${mini}</div><span class="progress-text">${rc} of ${total}</span></div>
    </div></div>`;
  window.scrollTo(0,0);
}

function renderArticle(idx){
  const ed=curEd;if(idx<0||idx>=ed.stories.length)return;
  curStory=idx;const s=ed.stories[idx],i=Math.max(0,EDITIONS.indexOf(ed));
  markRead(ed.id,idx);
  const qt=(s.overview&&s.overview.length)?`<div class="qt"><div class="qt-h">Quick take</div><ul>${
    s.overview.map(o=>`<li>${o.label?`<b>${esc(o.label)}:</b> `:''}${esc(o.text)}</li>`).join('')}</ul></div>`:'';
  const body=(s.body&&s.body.length?s.body:['Could not fetch — link only.']).map(p=>`<p>${esc(p)}</p>`).join('');
  const meta=[s.source,s.date].filter(Boolean).map(esc).join(' · ');
  const link=s.url?`<a class="s-link" href="${esc(s.url)}" target="_blank" rel="noopener">Read on the web →</a>`:'';
  const last=idx===ed.stories.length-1;
  shell.innerHTML=`<div class="view active"><div class="article">
    <div class="a-top"><div class="icon-btn" onclick="renderList()">${IB}</div>
      <div class="a-count">${idx+1} / ${ed.stories.length}</div>
      <div class="icon-btn" onclick="renderList()">${IX}</div></div>
    <div class="a-hero" style="background:${heroBg(i,s.image)}"></div>
    <div class="a-inner">
      ${catDot(s)}
      <h1 class="a-headline">${esc(s.headline)}</h1>
      <div class="a-meta">${meta}</div>
      ${qt}
      <div class="a-body">${body}</div>
      <div class="a-source"><span class="s-txt">${esc(s.source)}</span>${link}</div>
      <div class="a-nav">
        <button onclick="renderArticle(${idx-1})" ${idx===0?'disabled':''}>← Prev</button>
        <button class="primary" onclick="${last?'renderList()':'renderArticle('+(idx+1)+')'}">${last?'Back to list':'Next story →'}</button>
      </div>
    </div></div></div>`;
  window.scrollTo(0,0);
}

function openEdition(id){curEd=EDITIONS.find(e=>e.id===id)||curEd;tab='today';renderCover();}

function renderArchive(){
  if(!EDITIONS.length){shell.innerHTML='<div class="empty">No editions yet.</div>';return;}
  const cards=EDITIONS.map((ed,i)=>{
    const total=ed.stories.length;
    const dots=ed.stories.map(s=>`<span class="d" style="background:${CATS[s.cat]||CATS.tech}"></span>`).join('');
    const badge=ed.in_progress?'<span class="badge live">TODAY · LIVE</span>':(i===0?'<span class="badge latest">LATEST</span>':'');
    return `<div class="ed-card" onclick="openEdition('${ed.id}')">${badge}
      <div class="ed-wash" style="background:${bg(i,ed.stories[0].image)}"></div>
      <div class="ed-body"><div class="ed-date">${esc(ed.date)}</div>
        <div class="ed-dateline">${esc(ed.weekday)} · ${total} ${total===1?'link':'links'}${ed.in_progress?' so far':''}</div>
        <div class="ed-lead">${esc(ed.stories[0].headline)}</div>
        <div class="ed-dots">${dots}</div></div></div>`;
  }).join('');
  shell.innerHTML=`<div class="view active"><div class="archive">
    <div class="arch-head"><div class="arch-title">Past editions</div>
      <div class="arch-sub">Newest first · updated ${UPDATED}</div></div>
    ${cards}</div></div>`;
  window.scrollTo(0,0);
}

/* swipe left/right to move between articles */
let tx=0,ty=0;
document.addEventListener('touchstart',e=>{tx=e.changedTouches[0].clientX;ty=e.changedTouches[0].clientY;},{passive:true});
document.addEventListener('touchend',e=>{
  if(!shell.querySelector('.article'))return;
  const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
  if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5){
    if(dx<0&&curStory<curEd.stories.length-1)renderArticle(curStory+1);
    else if(dx>0&&curStory>0)renderArticle(curStory-1);
  }
},{passive:true});

go('today');
</script></body></html>"""


if __name__ == "__main__":
    raise SystemExit(build())
