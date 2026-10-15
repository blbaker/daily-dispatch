#!/usr/bin/env python3
"""Push digest editions into the Daily Dispatch API (DynamoDB via Lambda URL).

Two sources:
  finished editions  $DAILY_DISPATCH_WEB_DIR/link_digest_YYYYMMDD.html
                     (the day's prose digest) -> inProgress=false
  live edition       $DAILY_DISPATCH_LINK_STORE (links pushed since the last
                     roll-up) -> inProgress=true. Called by the Pushbullet
                     bridge after every saved link so the app's Today tab
                     updates in real time.

Inner links: when a shared link is a wrapper (a Threads/Reddit/HN/Bluesky
post, a share.google redirect, or any thin page) whose text points at
another link, that inner article is fetched too and attached as
story["linked"].

Pages are fetched once and cached (scrape-cache.json, versioned) so each new
push only fetches the new link. See config.py for DIGEST_API_URL /
DIGEST_API_KEY and the other environment variables this script reads.

Usage:
  push_to_api.py [WEB_DIR] [--date YYYY-MM-DD] [--no-fulltext]
  push_to_api.py --live
"""
import fcntl
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import config  # noqa: E402
import digest_enrich as enrich  # noqa: E402
import digest_editions as editions  # noqa: E402

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124 Safari/537.36")
# Threads/Meta serve an og-less JS shell to full browser UAs, but the complete
# post (og:description with the outbound link) to a bare UA.
UA_SOCIAL = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
CACHE_V = 5
NO_FETCH = ("x.com", "twitter.com")            # login wall, nothing usable
NO_TEXT = ("youtube.com", "youtu.be")           # og tags only, body is junk
WRAPPERS = ("threads.net", "threads.com", "reddit.com", "news.ycombinator.com",
            "bsky.app", "mastodon", "lobste.rs", "linkedin.com", "facebook.com")
INNER_IGNORE = ("threads.", "instagram.", "facebook.", "fbcdn.", "cdninstagram.",
                "x.com", "twitter.com", "gstatic.", "googleapis.", "schema.org",
                "w3.org", "apple.com", "play.google.")
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+")
BARE_RE = re.compile(r"\b(?:github\.com|gitlab\.com|huggingface\.co|arxiv\.org)/[\w./-]+")
TRACKING = ("shem", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
            "fbclid", "gclid", "ref_src", "igshid")

CAT_RULES = [
    ("sports", r"\b(nba|nfl|game|season|playoff|quarterback)\b"),
    ("science", r"\b(climate|research|study|space|nasa|physic|scien|model|quantum|gpu)\b"),
    ("entertainment", r"\b(plex|tv|movie|show|film|music|stream|episode|television|netflix)\b"),
    ("business", r"\b(acqui|funding|revenue|market share|enterprise|ipo|startup)\b"),
    ("world", r"\b(united nations|global|europe|china|ukraine)\b"),
    ("us", r"\b(senate|congress|washington|u\.s\.|federal)\b"),
]
JUNK = enrich.JUNK


def infer_cat(text):
    t = text.lower()
    for cat, pat in CAT_RULES:
        if re.search(pat, t):
            return cat
    return "tech"


def clean_url(url):
    """Drop share/tracking params (share.google appends ?shem=...)."""
    try:
        p = urllib.parse.urlsplit(url)
        q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
             if k.lower() not in TRACKING]
        return urllib.parse.urlunsplit(p._replace(query=urllib.parse.urlencode(q)))
    except Exception:
        return url


def host_of(url):
    m = re.match(r"https?://([^/?#]+)", url or "")
    return m.group(1).lower().replace("www.", "") if m else ""


def _meta(raw, *names):
    for n in names:
        for pat in (
            rf'<meta[^>]+(?:property|name)=["\']{n}["\'][^>]+content=["\']([^"\']+)',
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{n}["\']',
        ):
            m = re.search(pat, raw, re.I)
            if m:
                return html.unescape(m.group(1).strip())
    return ""


def _fulltext(raw):
    return enrich.extract_text(raw)


def _fetch(url):
    """-> (final_url_after_redirects, raw_html). raw is '' on failure."""
    def get(ua):
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=20) as r:
            return clean_url(r.geturl()), r.read(900000).decode("utf-8", "replace")
    try:
        final, raw = get(UA)
        # social wrappers (incl. share.google -> threads) need the bare UA
        if any(w in host_of(final) for w in WRAPPERS) and not _meta(raw, "og:description"):
            final, raw = get(UA_SOCIAL)
        return final, raw
    except Exception:
        try:
            return get(UA_SOCIAL)
        except Exception:
            return clean_url(url), ""


def _x_links(post_url):
    """Full text + t.co links of an X/Twitter post via the public oEmbed
    endpoint (og:description truncates before the link). -> (text, [urls])."""
    m = re.search(r"(?:x|twitter)\.com/([^/?#]+)/status/(\d+)", post_url)
    if not m:
        return "", []
    api = ("https://publish.twitter.com/oembed?omit_script=1&url="
           + urllib.parse.quote(f"https://x.com/{m.group(1)}/status/{m.group(2)}"))
    try:
        with urllib.request.urlopen(urllib.request.Request(api, headers={"User-Agent": UA}),
                                    timeout=15) as r:
            h = json.load(r).get("html", "")
    except Exception:
        return "", []
    text = html.unescape(re.sub(r"<[^>]+>", " ", h))
    text = re.sub(r"\s*pic\.twitter\.com/\S+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*—\s*[^—]*\(@\w+\).*$", "", text, flags=re.S).strip()
    # t.co anchors that are NOT the attached-photo link (pic.twitter.com text)
    links = [a for a, label in re.findall(r'<a href="(https://t\.co/[^"]+)">([^<]*)</a>', h)
             if not label.startswith("pic.twitter.com")]
    return text, links


def _resolve(url):
    """Follow redirects (t.co etc.) -> final url, without keeping the body."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA}, method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.geturl()
    except Exception:
        return _fetch(url)[0]


def _info(final, raw):
    img = _meta(raw, "og:image", "og:image:url", "twitter:image")
    if img.startswith("//"):
        img = "https:" + img
    h = host_of(final)
    return {
        "title": _meta(raw, "og:title", "twitter:title"),
        "desc": _meta(raw, "og:description", "description", "twitter:description"),
        "image": img if img.startswith("http") else "",
        "fullText": "" if any(n in h for n in NO_TEXT) else _fulltext(raw),
    }


def _inner_link(page_host, raw, info):
    """The link a wrapper post points at, or ''."""
    cands = []
    m = re.search(r'class="titleline"><a href="(https?://[^"]+)"', raw)  # HN
    if m:
        cands.append(html.unescape(m.group(1)))
    text = f"{info['desc']} {info['title']}"
    cands += URL_RE.findall(text)
    cands += ["https://" + b for b in BARE_RE.findall(text)]
    for m in re.finditer(r"(?:l\.threads\.(?:net|com)/|l\.facebook\.com/l\.php|out\.reddit\.com/)"
                         r"\?u(?:rl)?=([^\"&\s]+)", raw):
        cands.append(urllib.parse.unquote(m.group(1)))
    for c in cands:
        c = c.rstrip(".,;:!?)")
        h = host_of(c)
        if not h or h == page_host or any(bad in h for bad in INNER_IGNORE):
            continue
        if re.search(r"\.(png|jpe?g|gif|webp|svg|mp4)(\?|$)", c, re.I):
            continue
        return c
    return ""


def scrape(url, cache, want_summary=True):
    """One fetch per URL -> {final,title,desc,image,fullText,linked,summary,overview}.
    Cached by URL; a cached entry without a summary is upgraded when asked."""
    ent = cache.get(url)
    if ent and ent.get("v") == CACHE_V:
        if want_summary and not ent.get("summary"):
            _summarize_into(ent)
        return ent
    res = {"v": CACHE_V, "final": url, "title": "", "desc": "", "image": "",
           "fullText": "", "linked": None, "summary": [], "overview": []}
    if url and not any(n in host_of(url) for n in NO_FETCH):
        final, raw = _fetch(url)
        h = host_of(final)
        # plain fetch blocked/slow/JS-only -> rendered HTML from Firecrawl (if configured)
        if not any(n in h for n in NO_FETCH + NO_TEXT) and len(enrich.extract_text(raw)) < 600:
            fc = enrich.firecrawl_raw(final)
            if len(enrich.extract_text(fc)) > len(enrich.extract_text(raw)):
                raw = fc
        if raw:
            res.update(_info(final, raw), final=final)
            h = host_of(final)
            inner = ""
            if any(n in h for n in NO_FETCH):
                # share.google -> x.com: og text is truncated; oEmbed has it all
                full, tco = _x_links(final)
                if len(full) > len(res["desc"]):
                    res["desc"] = full
                for t in tco:
                    r2 = _resolve(t)
                    if r2 and not any(bad in host_of(r2) for bad in INNER_IGNORE):
                        inner = r2
                        break
            elif any(w in h for w in WRAPPERS) or len(res["fullText"]) < 400:
                inner = _inner_link(h, raw, res)
            if inner and not any(n in host_of(inner) for n in NO_FETCH):
                f2, raw2 = _fetch(inner)
                if raw2 and host_of(f2) != h:
                    i2 = _info(f2, raw2)
                    res["linked"] = {"url": f2, "title": i2["title"] or host_of(f2),
                                     "desc": i2["desc"], "image": i2["image"],
                                     "fullText": i2["fullText"]}
                    res["image"] = res["image"] or i2["image"]
    if want_summary:
        _summarize_into(res)
    cache[url] = res
    return res


def _summarize_into(res):
    """Axios-style summary + overview from the best text we have."""
    linked = res.get("linked") or {}
    src_text = res["fullText"] or linked.get("fullText", "") or res["desc"]
    if len(src_text) < 200:
        return
    title = linked.get("title") if (not res["fullText"] and linked) else res["title"]
    got = enrich.summarize(title or res["title"] or host_of(res["final"]), src_text)
    if got:
        res["summary"], res["overview"] = got["summary"], got["overview"]


def load_cache():
    try:
        return json.loads(config.SCRAPE_CACHE.read_text())
    except Exception:
        return {}


def save_cache(cache):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = config.SCRAPE_CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache))
    tmp.replace(config.SCRAPE_CACHE)


def edition_meta(d):
    return {
        "id": d.strftime("%Y-%m-%d"),
        "date": d.strftime("%B %-d"),
        "full": d.strftime("%A, %B %-d, %Y"),
        "weekday": d.strftime("%A").lower(),
    }


def _finish(day, stories, in_progress=False):
    ed = edition_meta(day)
    ed["hero"] = next((x["image"] for x in stories if x["image"]), "")
    if in_progress:
        ed["inProgress"] = True
    ed["stories"] = stories
    return ed


def parse_edition(path, cache, want_full=True):
    """Finished digest html -> edition dict."""
    got = editions.parse_finished(path, lambda u, want_summary=True: scrape(u, cache, want_summary),
                                  infer_cat, want_full)
    return _finish(*got) if got else None


def live_edition(cache):
    """links.jsonl -> in-progress edition."""
    got = editions.build_live(config.LINK_STORE, config.WEB_DIR,
                              lambda u: scrape(u, cache), infer_cat, host_of, WRAPPERS)
    return _finish(*got, in_progress=True) if got else None


def post_edition(base, key, ed):
    req = urllib.request.Request(
        f"{base}/editions", data=json.dumps(ed).encode(), method="POST",
        headers={"content-type": "application/json", "x-api-key": key})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read().decode()


def main():
    argv = sys.argv[1:]
    only_date = None
    if "--date" in argv:
        i = argv.index("--date")
        only_date = argv[i + 1]
        del argv[i:i + 2]  # the date value is NOT the WEB_DIR positional
    live = "--live" in argv
    want_full = "--no-fulltext" not in argv
    positional = [a for a in argv if not a.startswith("--")]
    web = Path(positional[0]).expanduser() if positional else config.WEB_DIR

    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(config.PUSH_LOCK, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)  # serialize back-to-back bridge pushes
        base, key = config.digest_api_conf()
        if not base or not key:
            print("DIGEST_API_URL / DIGEST_API_KEY not configured; nothing to push to", file=sys.stderr)
            return 1
        cache = load_cache()
        eds = []
        if live:
            ed = live_edition(cache)
            if ed:
                eds.append(ed)
        else:
            for f in sorted(web.glob("link_digest_*.html")):
                if only_date and f.name != f"link_digest_{only_date.replace('-', '')}.html":
                    continue
                ed = parse_edition(f, cache, want_full)
                if ed:
                    eds.append(ed)
        save_cache(cache)
        n = 0
        for ed in eds:
            st, body = post_edition(base, key, ed)
            print(f"{ed['id']}: {st} {body}")
            n += 1
        print(f"pushed {n} edition(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
