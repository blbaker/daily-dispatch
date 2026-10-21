# Pipeline

The pipeline is the Python half of Daily Dispatch. It captures the links you
push from your phone during the day, and once a day it turns them into a
digest page and an edition the app can show. The scripts are in `pipeline/`
and the writing is done by two Claude Code skills in `.claude/skills/`.

It runs without a backend. With no backend configured, the digest and the
archive app are plain HTML files on disk.

## Capture links

`pushbullet_bridge.py` listens to your Pushbullet account and appends every
link you push to a local file. It needs a Pushbullet access token from
pushbullet.com, under Settings, Account.

```sh
pip install websocket-client
export PUSHBULLET_TOKEN=<your token>
python3 pipeline/pushbullet_bridge.py
```

It backfills what you pushed today, then appends each new link to
`~/.daily-dispatch/links.jsonl`. Set `DAILY_DISPATCH_HOME` to keep the link
store, the archive and the rendered pages somewhere else.

Keep the bridge running with whatever your OS uses for long-running jobs: a
systemd user service, launchd, or a `tmux` session. The repository does not
ship a service file for it.

Two optional hooks run after each saved link:

- When `DIGEST_API_URL` and `DIGEST_API_KEY` are set, the bridge starts
  `push_to_api.py --live` in the background. That sends the day's links so
  far to the backend as an in-progress edition, so the app's Today tab
  updates while the day goes on.
- When `LINK_WEBHOOK_URL` is set, the bridge posts each link there, signed
  with HMAC-SHA256 using `LINK_WEBHOOK_SECRET`.

## Write the digest

The `daily-digest` skill reads the captured links, fetches each page, writes
a prose summary of every story, and renders the result. Run `claude` in the
repository (Claude Code loads `.claude/skills/` from there) and ask for the
`daily-digest` skill, or install the skills elsewhere with:

```sh
npx skills add blbaker/daily-dispatch
```

The skill runs these steps, which you can also run by hand:

1. `pipeline/digest_collect.sh` prints the pending links and moves the link
   store into `archive/`, so no link is digested twice. Set `DIGEST_PEEK=1`
   to read the links without moving them, for a test run.
2. The skill writes the digest as Markdown, then
   `pipeline/md2digest.py IN.md OUT.html` renders it as a newspaper-style
   page. Give it an `OUT.pdf` instead to print a PDF through headless
   Chromium.
3. `pipeline/build_ynd_app.py` scans `web/link_digest_YYYYMMDD.html` and
   writes one self-contained `web/index.html`, the archive app. Open it in
   any browser. With a backend configured, it then runs
   `pipeline/push_to_api.py` to send the finished edition. The backend sends
   the new-edition push notification when a finished edition arrives.

Summaries come from whatever `SUMMARIZE_CMD` runs. It defaults to
`claude -p`; any command that takes the prompt as its last argument and
prints the answer works. If it fails, the pipeline falls back to a local
Ollama model (`OLLAMA_URL`, `OLLAMA_MODEL`). Pages that a plain fetch cannot
read can go through a self-hosted Firecrawl instance at `FIRECRAWL_URL`.

To get a digest every day, run the skill from cron, a systemd timer or any
scheduler that can run a shell command.

## Voice the podcast with the Python script

The `link-talk-podcast` skill writes a two-host script from the day's
stories and voices it with ElevenLabs Text-to-Dialogue through
`pipeline/podcast_make.py`. Start with a dry run, which calls nothing:

```sh
python3 pipeline/podcast_make.py --script-dir SCRIPT_DIR --voices voices.json \
  --out out/episode.mp3 --transcript out/episode.md --dry-run
```

Copy `pipeline/voices.example.json` to `voices.json` and put in real
ElevenLabs voice ids, set `ELEVENLABS_API_KEY`, and run it again without
`--dry-run`. Chunks are cached by content hash, so a fix to one part of the
script only re-voices that part.

The `daily-dispatch` CLI does the same job with a choice of script writers
and voice providers, and can run on a schedule. See
[Podcast providers](podcast-providers.md) and
[Daily episode](daily-podcast.md). The tone rules both use are in the
[script style guide](podcast-style-guide.md).

`pipeline/podcast_verify.py` transcribes a finished episode with
faster-whisper and compares it with the script. It reports the word match,
audio tags that were read aloud as words, and missing lines.

## Environment variables

Every variable is listed with comments in `.env.pipeline.example`. Only
`PUSHBULLET_TOKEN` is required, and only for the bridge.

| Variable | Used for |
|---|---|
| `PUSHBULLET_TOKEN` | The bridge's Pushbullet access token |
| `DAILY_DISPATCH_HOME` | Base directory, default `~/.daily-dispatch` |
| `DAILY_DISPATCH_LINK_STORE`, `DAILY_DISPATCH_ARCHIVE_DIR`, `DAILY_DISPATCH_WEB_DIR`, `DAILY_DISPATCH_SECRETS_DIR` | Override one location under the base directory |
| `DIGEST_API_URL`, `DIGEST_API_KEY` | The backend, if you run one. Can also be `api-url` and `api-key` files in the secrets directory |
| `LINK_WEBHOOK_URL`, `LINK_WEBHOOK_SECRET` | Forward each link to your own webhook |
| `SUMMARIZE_CMD` | Command that writes summaries, default `claude -p` |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Fallback summary model |
| `FIRECRAWL_URL` | Optional fetcher for pages that need a browser |
| `CHROMIUM_PATH` | Browser for PDF output |
| `ELEVENLABS_API_KEY` | `podcast_make.py` |
| `LISTENER_NAME`, `LISTENER_TOWN` | Who the podcast hosts say sent the links |

## Tests

```sh
python3 -m py_compile pipeline/*.py
python3 -m unittest discover -s tests
```

The tests cover the parsers and run without network access or an API key.
