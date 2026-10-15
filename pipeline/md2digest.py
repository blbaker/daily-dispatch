#!/usr/bin/env python3
"""Render the daily link digest markdown to a clean, neutral newspaper page.

Light editorial theme inspired by a modern newspaper site: white canvas,
black serif headlines, generous whitespace, hairline rules, small sans-serif
kickers. Prose summaries, not bullet dumps.

The FIRST line of the markdown may be a masthead directive:
    <!--MASTHEAD: The Daily Dispatch | Wednesday, September 17, 2026 | 5 links-->
It is pulled out and rendered as the masthead band.

Usage: uv run --with markdown --with pygments md2digest.py IN.md [OUT.{pdf,html}]
Output format is chosen by the extension of OUT: .pdf prints via headless
Chromium, .html/.htm writes the page directly (no browser needed).
"""
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown


def find_chromium():
    """A headless Chromium/Chrome binary for PDF printing. CHROMIUM_PATH
    overrides; otherwise look for a system Chrome/Chromium, then any
    Playwright-installed build under ~/.cache/ms-playwright."""
    env = os.environ.get("CHROMIUM_PATH")
    if env and Path(env).is_file():
        return Path(env)
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        found = subprocess.run(["which", name], capture_output=True, text=True).stdout.strip()
        if found:
            return Path(found)
    pw_cache = Path.home() / ".cache/ms-playwright"
    if pw_cache.is_dir():
        for candidate in sorted(pw_cache.glob("chromium-*/chrome-linux*/chrome"), reverse=True):
            if candidate.is_file():
                return candidate
    return None


CSS = """
@page { size: Letter; margin: 0; }
* { box-sizing: border-box; }
html { background: #ffffff; }
body {
  background: #ffffff; color: #121212;
  font: 11.5pt/1.72 "Georgia", "Bitstream Charter", "DejaVu Serif", serif;
  margin: 0; padding: 16mm 20mm 18mm; overflow-wrap: break-word; word-wrap: break-word;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* Masthead */
.masthead { text-align: center; border-bottom: 1px solid #121212; padding-bottom: 10px; margin-bottom: 4px; }
.masthead .title {
  font-family: "Georgia", "Bitstream Charter", serif; font-weight: 700;
  font-size: 32pt; letter-spacing: -.01em; color: #121212; line-height: 1.05; margin: 0;
}
.masthead .rule { border: none; border-top: 1px solid #cfcfcf; margin: 8px 0 7px; }
.masthead .meta {
  font-family: "Liberation Sans", "Helvetica Neue", Arial, sans-serif;
  text-transform: uppercase; letter-spacing: .22em; font-size: 7.4pt;
  color: #6b6b6b; margin: 0;
}
h1 { display: none; }
/* Headline per article */
h2 {
  font-family: "Georgia", "Bitstream Charter", serif; font-weight: 700;
  font-size: 17pt; color: #121212; line-height: 1.22;
  margin: 1.5em 0 .12em; letter-spacing: -.005em; page-break-after: avoid;
}
h2:first-of-type { margin-top: .9em; }
/* Byline / source line sits right under the headline as italic serif */
h2 + p { color: #555; font-style: italic; font-size: 10pt; margin: .1em 0 .55em; }
/* Section kickers if ever used */
h3 { font-family: "Liberation Sans", Arial, sans-serif; font-size: 7.8pt; font-weight: 700;
  text-transform: uppercase; letter-spacing: .16em; color: #8a8a8a;
  margin: 1.3em 0 .3em; }
p { margin: 0 0 .72em; }
/* Drop cap on the first body paragraph after a byline for that newspaper feel */
h2 + p + p::first-letter {
  font-family: "Georgia", serif; font-weight: 700; float: left;
  font-size: 3.05em; line-height: .82; padding: .02em .09em 0 0; color: #121212;
}
strong { color: #121212; font-weight: 700; }
em { color: #333; }
a { color: #326891; text-decoration: none; word-break: break-word; }
ul, ol { padding-left: 1.2em; margin: .3em 0 .72em; }
li { margin: .2em 0; }
li::marker { color: #9a9a9a; }
.source { font-family: "Liberation Sans", Arial, sans-serif; font-size: 7.8pt;
  letter-spacing: .02em; color: #8a8a8a; margin: -.15em 0 0; }
blockquote { border-left: 2px solid #d0d0d0; margin: .8em 0; padding: .1em 1em;
  color: #444; font-style: italic; }
/* Hairline divider between articles */
hr { border: none; border-top: 1px solid #e4e4e4; margin: 1.5em 0; }
/* Axios "The Rundown" box at the top */
.rundown { background: #f6f8fa; border: 1px solid #e3e7eb; border-left: 4px solid #1854a6;
  border-radius: 5px; padding: 13px 18px 12px; margin: 1.1em 0 1.7em; page-break-inside: avoid; }
.rundown-h { font-family: "Liberation Sans", Arial, sans-serif; text-transform: uppercase;
  letter-spacing: .17em; font-size: 8pt; font-weight: 700; color: #1854a6; margin: 0 0 .55em; }
.rundown ul { list-style: none; padding-left: 0; margin: 0; }
.rundown li { position: relative; padding-left: 1.15em; margin: .38em 0;
  font-size: 10.5pt; line-height: 1.5; }
.rundown li::before { content: "\\25aa"; color: #1854a6; position: absolute; left: 0; top: .05em; }
.rundown li strong:first-child { color: #111; }
.rundown li a { color: inherit; text-decoration: none; border-bottom: 1px solid #b9cde6; }
.rundown li a:hover { border-bottom-color: #1854a6; }
/* Per-article Axios "Quick take" overview box */
.overview { background: #f6f8fa; border-left: 3px solid #1854a6; border-radius: 4px;
  padding: 9px 14px 8px; margin: .2em 0 1em; page-break-inside: avoid; }
.overview-h { font-family: "Liberation Sans", Arial, sans-serif; text-transform: uppercase;
  letter-spacing: .15em; font-size: 7.2pt; font-weight: 700; color: #1854a6; margin: 0 0 .4em; }
.overview ul { list-style: none; padding-left: 0; margin: 0; }
.overview li { position: relative; padding-left: 1.05em; margin: .28em 0;
  font-size: 10pt; line-height: 1.45; }
.overview li::before { content: "\\25aa"; color: #1854a6; position: absolute; left: 0; top: .02em; }
.overview li strong:first-child { color: #1854a6; }
/* Per-article date line (sits under the byline) */
.artdate { font-family: "Liberation Sans", Arial, sans-serif; text-transform: uppercase;
  letter-spacing: .13em; font-size: 7.4pt; color: #9a9a9a; margin: -.35em 0 .7em; }
/* Axios-style highlight bullets inside an article: bold axis label in accent */
li > strong:first-child { color: #1854a6; }
code { background: #f2f2f2; color: #b3541e; padding: .08em .32em; border-radius: 3px;
  font-family: "DejaVu Sans Mono", monospace; font-size: .85em; }
.footer { margin-top: 2.2em; padding-top: .8em; border-top: 1px solid #121212;
  font-family: "Liberation Sans", Arial, sans-serif; font-size: 7.4pt; letter-spacing: .16em;
  text-transform: uppercase; color: #8a8a8a; text-align: center; }
/* On-screen (browser) reading: center a comfortable measure, larger type.
   Print output is unaffected — @media screen only. */
@media screen {
  html { background: #f4f4f2; }
  body { max-width: 720px; margin: 0 auto; padding: 40px 32px 64px;
    background: #ffffff; box-shadow: 0 1px 40px rgba(0,0,0,.08);
    font-size: 19px; line-height: 1.66; }
  .masthead .title { font-size: 44px; }
  h2 { font-size: 27px; }
  h2 + p { font-size: 15px; }
}
/* Phones: full-bleed, tighter gutters, scaled type so nothing overflows. */
@media screen and (max-width: 640px) {
  body { max-width: none; padding: 22px 18px 48px; box-shadow: none;
    font-size: 17.5px; line-height: 1.6; }
  .masthead .title { font-size: 30px; letter-spacing: -.02em; }
  .masthead .meta { font-size: 8.5px; letter-spacing: .14em; }
  h2 { font-size: 21px; line-height: 1.25; }
  h2 + p { font-size: 14px; }
  h2 + p + p::first-letter { font-size: 2.6em; }
  .source { font-size: 11px; word-break: break-all; }
}
"""

HTML = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title><style>{css}</style></head><body>{masthead}{body}</body></html>"""


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: md2digest.py IN.md [OUT.pdf]", file=sys.stderr)
        return 2
    src = Path(sys.argv[1]).expanduser().resolve()
    if not src.is_file():
        print(f"no such file: {src}", file=sys.stderr)
        return 1
    out = Path(sys.argv[2]).expanduser().resolve() if len(sys.argv) > 2 else src.with_suffix(".pdf")

    text = src.read_text(encoding="utf-8")

    # Robustness: markdown needs a blank line before a bullet list, else the
    # bullets collapse into a run-on paragraph. Insert one when a "- " line
    # directly follows a non-blank, non-list line.
    lines = text.split("\n")
    fixed = []
    for ln in lines:
        if ln.lstrip().startswith("- ") and fixed:
            prev = fixed[-1]
            if prev.strip() and not prev.lstrip().startswith(("- ", "* ", "#")):
                fixed.append("")
        fixed.append(ln)
    text = "\n".join(fixed)

    # Pull the masthead directive if present.
    masthead_html = ""
    m = re.match(r"\s*<!--MASTHEAD:\s*(.*?)-->\s*", text)
    if m:
        parts = [p.strip() for p in m.group(1).split("|")]
        title = parts[0] if parts else "Daily Dispatch"
        meta = "&nbsp;&nbsp;&middot;&nbsp;&nbsp;".join(parts[1:])
        masthead_html = (
            '<div class="masthead">'
            f'<p class="title">{title}</p>'
            '<hr class="rule">'
            f'<p class="meta">{meta}</p>'
            "</div>"
        )
        text = text[m.end():]

    # --- Fenced boxes -> placeholders, rendered separately, restored after ---
    # ::: rundown ... :::  -> top-of-page Axios summary card (bullets link to
    #                         each article in order)
    # ::: overview ... :::  -> per-article Axios "Quick take" box (repeatable)
    rundown_src = None
    mR = re.search(r"(?ms)^:::\s*rundown\s*\n(.*?)^:::\s*$", text)
    if mR:
        rundown_src = mR.group(1).strip()
        text = text[:mR.start()] + "\x00RUNDOWN\x00" + text[mR.end():]

    overview_srcs = []
    def _stash_overview(m):
        overview_srcs.append(m.group(1).strip())
        return f"\x00OVERVIEW{len(overview_srcs)-1}\x00"
    text = re.sub(r"(?ms)^:::\s*overview\s*\n(.*?)^:::\s*$", _stash_overview, text)

    body = markdown.markdown(text, extensions=["extra", "sane_lists"])

    # Give every article headline a stable slug id and collect them in order.
    article_ids = []
    def _slug(s):
        s = re.sub(r"<[^>]+>", "", s)
        s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
        return s[:60] or f"story-{len(article_ids)+1}"
    def _id_h2(m):
        sid = _slug(m.group(1))
        base, n = sid, 2
        while sid in article_ids:
            sid = f"{base}-{n}"; n += 1
        article_ids.append(sid)
        return f'<h2 id="{sid}">{m.group(1)}</h2>'
    body = re.sub(r"<h2>(.*?)</h2>", _id_h2, body, flags=re.S)

    # Render the rundown card; link each bullet to the matching article id.
    if rundown_src is not None:
        inner = markdown.markdown(rundown_src, extensions=["extra", "sane_lists"])
        idx = [0]
        def _linkli(m):
            i = idx[0]; idx[0] += 1
            if i < len(article_ids):
                return f'<li><a href="#{article_ids[i]}">{m.group(1)}</a></li>'
            return m.group(0)
        inner = re.sub(r"<li>(.*?)</li>", _linkli, inner, flags=re.S)
        card = ('<div class="rundown"><p class="rundown-h">The Rundown</p>'
                + inner + "</div>")
        body = body.replace("<p>\x00RUNDOWN\x00</p>", card).replace("\x00RUNDOWN\x00", card)

    # Render each per-article overview box.
    for i, src_txt in enumerate(overview_srcs):
        inner = markdown.markdown(src_txt, extensions=["extra", "sane_lists"])
        box = ('<div class="overview"><p class="overview-h">Quick take</p>'
               + inner + "</div>")
        body = body.replace(f"<p>\x00OVERVIEW{i}\x00</p>", box).replace(f"\x00OVERVIEW{i}\x00", box)

    # Make bare URLs inside .source divs clickable.
    def _linksource(m):
        url = m.group(1).strip()
        href = url if url.startswith(("http://", "https://")) else "https://" + url
        return f'<div class="source"><a href="{href}">{url}</a></div>'
    body = re.sub(r'<div class="source">\s*([^<]+?)\s*</div>', _linksource, body)

    html = HTML.format(title=src.stem, css=CSS, masthead=masthead_html, body=body)

    # Direct HTML output: if the target ends in .htm(l), just write the page.
    if out.suffix.lower() in (".html", ".htm"):
        out.write_text(html, encoding="utf-8")
        if not out.is_file() or out.stat().st_size < 500:
            print(f"FAILED to produce {out}", file=sys.stderr)
            return 1
        print(f"{out}  ({out.stat().st_size // 1024} KB)")
        return 0

    chrome = find_chromium()
    if chrome is None:
        print("no headless Chromium found; set CHROMIUM_PATH, install one, "
              "or render to .html instead", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as td:
        page = Path(td) / "page.html"
        page.write_text(html, encoding="utf-8")
        cmd = [
            str(chrome), "--headless", "--disable-gpu", "--no-sandbox",
            "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=4000",
            f"--print-to-pdf={out}", page.as_uri(),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if not out.is_file() or out.stat().st_size < 1000:
            sys.stderr.write(proc.stderr[-2000:])
            print(f"FAILED to produce {out}", file=sys.stderr)
            return 1

    print(f"{out}  ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
