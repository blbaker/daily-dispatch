"""Article text extraction + Axios-style summaries for the Daily Dispatch.

extract_text(url, raw):  best full article text from one page, trying in order
                         JSON-LD articleBody -> <article>/article-body <p> ->
                         all <p>. An optional self-hosted Firecrawl instance
                         (FIRECRAWL_URL) is the fallback for pages that give
                         nothing to a plain fetch; unset, that fallback is
                         skipped and the page just gets a thinner summary.
summarize(title, text):  {"summary":[prose paras], "overview":[{label,text}]}
                         written by SUMMARIZE_CMD (see config.py; defaults to
                         `claude -p`), falling back to local Ollama.
"""
import html
import json
import re
import shlex
import subprocess
import urllib.request

import config

MAX_TEXT = 12000
JUNK = (
    "you signed out", "you signed in", "you switched accounts", "dismiss alert",
    "{{", "}}", "reload to refresh", "enable javascript", "cookies", "sign in to",
    "captcha", "are you a robot", "your browser", "please enable", "loading...",
    "newsletter", "sign up", "subscribe", "terms of service", "privacy notice",
    "contact me with news", "by signing up", "all rights reserved", "copy link",
)


def _clean(frag):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", frag))).strip()


def _prose(paras):
    out = []
    for p in paras:
        if len(p) < 60 or any(j in p.lower() for j in JUNK):
            continue
        spaces = p.count(" ")
        if spaces < 6 or not re.search(r"[.!?\"\u201d]", p):
            continue
        if re.search(r"[a-z][A-Z]", p) and spaces < len(p) / 12:
            continue  # glued CamelCase nav runs
        if p not in out:
            out.append(p)
    return out


def _jsonld_body(raw):
    best = ""
    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', raw, re.S | re.I):
        try:
            data = json.loads(m.group(1).strip())
        except Exception:
            continue
        stack = [data]
        while stack:
            x = stack.pop()
            if isinstance(x, dict):
                b = x.get("articleBody")
                if isinstance(b, str) and len(b) > len(best):
                    best = b
                stack.extend(x.values())
            elif isinstance(x, list):
                stack.extend(x)
    if not best:
        return []
    # articleBody is plain text, or (some CMSes) HTML-escaped HTML
    b = html.unescape(best)
    if "<p" in b:
        return _prose([_clean(p) for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", b)])
    return _prose([p.strip() for p in re.split(r"\n\s*\n|\r\n\r\n", b) if p.strip()] or [b])


def _html_body(raw):
    body = re.sub(r"(?is)<script.*?</script>|<style.*?</style>|<nav.*?</nav>|<footer.*?</footer>", " ", raw)
    for pat in (r'(?is)<article\b.*?</article>', r'(?is)id="article-body".*'):
        m = re.search(pat, body)
        if m:
            ps = _prose([_clean(p) for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", m.group(0)[:400000])])
            if sum(map(len, ps)) > 600:
                return ps
    return _prose([_clean(p) for p in re.findall(r"(?is)<p[^>]*>(.*?)</p>", body)])


def extract_text(raw):
    """Full article text from raw HTML ('' if nothing usable)."""
    for fn in (_jsonld_body, _html_body):
        ps = fn(raw)
        if sum(map(len, ps)) > 600:
            return "\n\n".join(ps)[:MAX_TEXT]
    return ""


def firecrawl_raw(url):
    """Rendered HTML via an optional self-hosted Firecrawl (slow sites, JS
    pages). Returns '' immediately if FIRECRAWL_URL isn't configured."""
    if not config.FIRECRAWL_URL:
        return ""
    try:
        req = urllib.request.Request(
            config.FIRECRAWL_URL, method="POST",
            data=json.dumps({"url": url, "formats": ["rawHtml"], "onlyMainContent": False,
                             "timeout": 90000}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=110) as r:
            d = json.load(r)
        return (d.get("data") or {}).get("rawHtml", "") if d.get("success") else ""
    except Exception:
        return ""


PROMPT = (
    "You write a daily news digest in the Axios Smart Brevity style, in plain "
    "human prose (no AI-isms, no hype). Summarize the article below. Return ONLY a JSON "
    "object, no code fence:\n"
    '{{"summary":["2-3 short prose paragraphs: what happened, key specifics, real numbers"],'
    '"overview":[{{"label":"Why it matters","text":"one sentence"}},'
    '{{"label":"By the numbers","text":"one sentence, only if the article has numbers"}},'
    '{{"label":"The big picture","text":"one sentence"}},'
    '{{"label":"What\'s next","text":"one sentence"}}]}}\n'
    "Use only facts in the article. Omit any overview item the article can't support.\n\n"
    "TITLE: {title}\n\nARTICLE:\n{text}"
)


def _parse(out):
    m = re.search(r"\{.*\}", out or "", re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
    except Exception:
        return None
    summ = [s.strip() for s in d.get("summary", []) if isinstance(s, str) and s.strip()]
    over = [{"label": str(o.get("label", "")).strip(), "text": str(o.get("text", "")).strip()}
            for o in d.get("overview", []) if isinstance(o, dict) and o.get("text")]
    return {"summary": summ, "overview": over} if summ else None


def summarize(title, text):
    """Axios-style summary + overview, or None if both writers fail."""
    prompt = PROMPT.format(title=title, text=text[:7000])
    cmd = shlex.split(config.SUMMARIZE_CMD) + [prompt]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=150)
        got = _parse(r.stdout)
        if got:
            got["by"] = cmd[0]
            return got
    except Exception:
        pass
    try:
        req = urllib.request.Request(
            config.OLLAMA_URL, headers={"Content-Type": "application/json"},
            data=json.dumps({"model": config.OLLAMA_MODEL, "prompt": prompt, "stream": False,
                             "format": "json", "options": {"temperature": 0.2, "num_ctx": 8192}}).encode())
        with urllib.request.urlopen(req, timeout=180) as r:
            got = _parse(json.load(r).get("response", ""))
        if got:
            got["by"] = "ollama"
            return got
    except Exception:
        pass
    return None
