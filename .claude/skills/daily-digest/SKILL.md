---
name: daily-digest
description: Turn today's pushed links into a daily digest (HTML newspaper page) and refresh the archive app.
---

# Daily digest

Turns the links captured by the Pushbullet listener into one digest page,
written in prose (not a bullet dump), and rebuilds the archive app so it
shows up in Daily Dispatch.

## Source rule

The only articles in the digest are the links the listener actually sent,
from the script output below. Never add, scout, or suggest any other
article or "related" link. If three links came in, the digest has exactly
those three.

## Style

Axios "Smart Brevity" meets a neutral newspaper brief. Open with a Rundown
box, then give each story a short overview box plus 2-3 natural paragraphs
of prose, written so the reader never needs to open the source. Natural
voice: vary sentence rhythm, no AI-slop words ("testament", "pivotal",
"underscores", "landscape", "delve"), no dash spam, no rule-of-three lists.
Neutral and factual, not hypey.

## Steps

1. Run `pipeline/digest_collect.sh`. For a test run, set `DIGEST_PEEK=1` so
   it reads the link store without consuming it; only a real scheduled run
   should consume the store. It prints one of:
   - `NO_LINKS` -- nothing was pushed. Write one short line: "No links
     pushed today -- nothing to digest." and stop.
   - `PENDING_LINKS=N`, `ARCHIVE_FILE=...`, `WEB_DIR=...`, then
     `---LINKS---` followed by N JSON lines (url, title, body,
     captured_iso).

2. For each link, resolve the final URL (follow redirects) and fetch the
   page. Read enough of the article to summarize it accurately -- never
   summarize from the headline alone. Capture the article's publish date if
   the page has one (otherwise use `captured_iso`). For a YouTube link,
   summarize from the title and description.

3. Write markdown to `/tmp/link_digest_YYYYMMDD.md` (real local date),
   following this structure exactly:
   - First line, no blank line before it:
     `<!--MASTHEAD: Daily Dispatch | <Weekday, Month D, YYYY> | <N> links-->`
   - A Rundown box, one bullet per article, in the SAME ORDER as the
     articles below it (the renderer links each bullet to its article):
     ```
     ::: rundown
     - **<subject>** <one-line what/why>.
     :::
     ```
   - Then, per article:
     ```
     ## <headline, sentence case, plain>
     *<Source>, <Author if known> -- <2-4 min read>*
     <div class="artdate">Published <Month D, YYYY></div>

     ::: overview
     - **Why it matters:** <one line>
     - **By the numbers:** <one line, only if real figures exist>
     :::

     <Paragraph 1: the lede, 2-4 sentences.>

     <Paragraph 2: the substance, key facts in flowing prose. Optional short
     third paragraph. Keep total prose under ~160 words.>

     <div class="source"><resolved URL, bare, no markdown link></div>
     ```
     Use 2-3 overview bullets per article, picking whichever Axios-style
     labels fit: Why it matters / By the numbers / The big picture / What's
     next / Between the lines / Go deeper.
   - A blank line, then `---`, then a blank line between articles.
   - End with:
     `<div class="footer">The day's links, briefed</div>`
   - If a page can't be fetched, still include its Rundown bullet, a `##`
     headline (title or URL), the artdate (captured date), one line "Could
     not fetch -- link only." where the prose goes, and the source div.
     Skip the overview box for that one. Never invent facts.

4. Render the dated digest:
   ```
   python3 pipeline/md2digest.py /tmp/link_digest_YYYYMMDD.md /tmp/link_digest_YYYYMMDD.html
   ```
   Then copy it into the web dir printed by step 1 (`WEB_DIR`), creating the
   directory if needed. Don't touch `WEB_DIR/index.html` directly -- the
   next step owns it.

5. Rebuild the archive app:
   ```
   python3 pipeline/build_ynd_app.py <WEB_DIR>
   ```
   Confirm it printed an edition count that includes today's.

6. Verify: open the dated digest HTML at a phone-width viewport and check
   the masthead, the Rundown jump links, each article's overview box and
   source link, and that nothing overflows horizontally. Open
   `WEB_DIR/index.html` too and confirm today's edition card is present,
   newest first.

7. Report back: link count, one highlight, and where the digest and
   archive app live. If `DIGEST_API_URL`/`DIGEST_API_KEY` are configured,
   `pipeline/build_ynd_app.py` already pushed the finished edition to the
   backend -- mention that it's live in the app too.
