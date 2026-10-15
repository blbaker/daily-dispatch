"""Build app editions from (a) finished 5 PM digest HTML and (b) the live
link store. Each story carries: summary (prose paras), overview (Axios
bullets [{label,text}]), fullText (in-app full article), url, image, linked.

No machine- or account-specific values live here; this module only parses
HTML and JSONL that other pipeline scripts hand it.
"""
import html
import json
import re
import urllib.parse
from datetime import datetime, timedelta


def _txt(frag):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", frag))).strip()


def overview_from_html(block):
    """Axios Quick Take bullets the 5 PM digest writes into
    <div class="overview"><ul><li><strong>Label:</strong> text</li>..."""
    m = re.search(r'<div class="overview">(.*?)</div>', block, re.S)
    out = []
    if not m:
        return out
    for li in re.findall(r"<li>(.*?)</li>", m.group(1), re.S):
        lm = re.match(r"\s*<strong>(.*?)</strong>\s*(.*)", li, re.S)
        if lm:
            out.append({"label": _txt(lm.group(1)).rstrip(":"), "text": _txt(lm.group(2))})
        elif _txt(li):
            out.append({"label": "", "text": _txt(li)})
    return out


def parse_finished(path, scrape, infer_cat, want_full=True):
    """5 PM digest html -> edition. The digest's own prose + Quick Take win;
    the scrape adds full text, image, linked article."""
    m = re.search(r"link_digest_(\d{8})\.html$", path.name)
    if not m:
        return None
    s = path.read_text(encoding="utf-8", errors="replace")
    stories = []
    for b in re.split(r"(?=<h2\b)", s):
        hm = re.search(r"<h2[^>]*>(.*?)</h2>", b, re.S)
        headline = _txt(hm.group(1)) if hm else ""
        if not headline:
            continue
        bym = re.search(r"<em>(.*?)</em>", b, re.S)
        byline = _txt(bym.group(1)) if bym else ""
        um = re.search(r'<div class="source">\s*(?:<a[^>]*href="([^"]*)")?', b)
        url = (um.group(1) if um and um.group(1) else "").strip()
        body = re.sub(r'<div class="overview">.*?</div>\s*', "", b, flags=re.S)
        body = re.sub(r'<div class="(source|artdate)">.*?</div>', "", body, flags=re.S)
        body = re.sub(r"<p>\s*<em>.*?</em>\s*</p>", "", body, flags=re.S)
        paras = [_txt(p) for p in re.findall(r"<p>(.*?)</p>", body, re.S)]
        summary = [p for p in paras if p and "min read" not in p.lower()]
        overview = overview_from_html(b)
        sc = scrape(url, want_summary=not (summary and overview)) if (want_full and url) else {}
        stories.append({
            "cat": infer_cat(headline + " " + " ".join(summary[:1]) + " " + byline),
            "headline": headline, "source": byline or "Link", "url": url,
            "summary": summary or sc.get("summary", []),
            "overview": overview or sc.get("overview", []),
            "fullText": sc.get("fullText", ""), "image": sc.get("image", ""),
            "linked": sc.get("linked"),
        })
    if not stories:
        return None
    return datetime.strptime(m.group(1), "%Y%m%d"), stories


def build_live(store, web_dir, scrape, infer_cat, host_of, wrappers):
    """links.jsonl -> (edition date, stories). Dated today, or tomorrow once
    today's 5 PM digest exists (those links belong to the next edition)."""
    if not store.exists():
        return None
    now = datetime.now()
    day = now + timedelta(days=1) if (web_dir / f"link_digest_{now:%Y%m%d}.html").exists() else now
    stories, seen = [], set()
    for line in store.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            rec = json.loads(line)
        except Exception:
            continue
        url = (rec.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        sc = scrape(url)
        final = sc["final"] or url
        host = host_of(final) or "Link"
        slug = urllib.parse.urlparse(final).path.strip("/").split("/")[-1]
        linked = sc.get("linked")
        # a wrapper post's own title is just "<user> on Threads": lead with
        # the article it points at
        headline = ((linked or {}).get("title") if linked and any(w in host for w in wrappers) else "") \
            or sc["title"] or (rec.get("title") or "").strip() \
            or slug.replace("-", " ").replace("_", " ").strip().capitalize() or host
        desc = sc["desc"] or (rec.get("body") or "").strip()
        stories.append({
            "cat": infer_cat(headline + " " + desc),
            "headline": headline, "source": host, "url": final,
            "summary": sc.get("summary") or ([desc] if desc else []),
            "overview": sc.get("overview", []),
            "fullText": sc["fullText"], "image": sc["image"], "linked": linked,
        })
    return (day, stories) if stories else None
