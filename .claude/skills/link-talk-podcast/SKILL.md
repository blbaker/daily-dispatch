---
name: link-talk-podcast
description: Turn a digest's links into a two-host "Link Talk" podcast episode voiced with ElevenLabs Text-to-Dialogue.
---

# Link Talk podcast

Turns a day's (or a date range's) links into a two-host podcast episode,
styled like a call-in radio show, voiced with ElevenLabs Text-to-Dialogue.
Read `docs/podcast-style-guide.md` before writing a script -- it has the
tone rules (joke density, caller personas, sign-off) in full.

## Gather the stories

If the backend is configured, pull stories from the Daily Dispatch API:
`GET $DIGEST_API_URL/editions` then `GET $DIGEST_API_URL/editions/<id>`,
header `x-api-key: $DIGEST_API_KEY`. Otherwise read the rendered digest
HTML directly from `$DAILY_DISPATCH_WEB_DIR`. Either way, dedupe by URL
across the editions you're covering, and compact each story to roughly 350
characters before writing. Read every story before writing a line of
script -- every fact in the episode has to come from these summaries.

## Write the script

Write one or more `.txt` files into a script directory, read in filename
order. Format:

```
## Segment title
TAG: [optional audio tag] line of dialogue
```

- `## ` starts a new segment (a longer pause plays between segments).
- `TAG:` must be a key in your voices map (see below). Every line needs
  actual words -- a line that's only an audio tag like `S2: [laughs]` is
  rejected by the ElevenLabs API and by the script parser.
- Audio tags (`[laughing]`, `[sighs]`, `[phone ringing]`, etc.) work best on
  roughly one line in six.
- Keep each file to about 6,000-7,000 characters so a fix only re-voices a
  small slice of the episode (chunks are cached by content hash).
- Set `LISTENER_NAME` and `LISTENER_TOWN` env vars before writing, and use
  them in the framing: the hosts are going through a pile of links sent in
  by that person. Defaults are neutral placeholders if you skip this.

## Voices

Copy `pipeline/voices.example.json` to your own `voices.json` and fill in
real ElevenLabs voice IDs: your own cloned voices (or two Voice Library
picks) for the two hosts, plus any caller voices you want to use. The file
maps `TAG -> {"id": "...", "name": "..."}`; `name` is what shows up in the
transcript. Keep your real `voices.json` out of git -- it's listed in
`.gitignore`.

For caller voices, ElevenLabs' shared Voice Library
(`GET /v1/shared-voices?sort=usage_character_count_1y&language=en`) has
plenty of free-to-use voices (filter `rate == 1.0 and fiat_rate is None` to
avoid extra credit cost). Use the shared `voice_id` directly in
`voices.json` -- no extra setup needed.

## Generate

Dry run first -- parses the script, writes the transcript, and prints the
estimated character count and runtime. It never calls the ElevenLabs API,
so it costs nothing and needs no key:

```
python3 pipeline/podcast_make.py --script-dir SCRIPT_DIR --voices voices.json \
  --out out/episode.mp3 --transcript out/episode.md --dry-run
```

Check the segment/chunk counts and read the transcript before spending any
credits. Then run the same command without `--dry-run` (needs
`ELEVENLABS_API_KEY` set). It aborts up front if the script needs more
characters than your account has left.

## Verify

```
pip install faster-whisper
python3 pipeline/podcast_verify.py SCRIPT_DIR out/episode.mp3 out/
```

This transcribes the output (fast, low-accuracy model) and diffs it against
the script. Look for: a word-match ratio of 0.9 or better (the rest is
transcription noise), "audio tags read aloud as words: none", and no `GAP`
lines (a gap means a span of script never made it into the audio).

## Deliver

Convert to a small file for sharing if needed:

```
ffmpeg -i out/episode.mp3 -ac 1 -c:a libopus -b:a 24k -application voip out/episode.ogg
```

Keep your script sources (the `.txt` files, `voices.json`, the stories you
pulled) somewhere outside git if they contain anything you don't want
public -- `pipeline/examples/link-talk-script/` is a safe, generic
reference, not a place to drop your real episode.
