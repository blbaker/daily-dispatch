# Daily Dispatch

A personal news digest, end to end: you push links from your phone all day,
Claude turns them into a daily digest and reads it into a two-host podcast,
and you read or listen to the result in a small app built for your phone or
an e-ink tablet.

This repo has four pieces:

- **`app/`** -- an Expo (React Native) app, phone and e-ink builds, styled
  like the old Yahoo News Digest app.
- **`backend/`** -- an AWS CDK stack (DynamoDB + a Lambda behind a Function
  URL + an S3 bucket for app releases). Cheap enough to run for one person.
- **`pipeline/`** -- the scripts that capture pushed links, turn them into
  an HTML digest, and rebuild the app's data.
- **`.claude/skills/`** -- two Claude Code skills (`daily-digest` and
  `link-talk-podcast`) that do the actual writing.

None of it needs all of it. The pipeline and skills work with just a local
link store and no backend at all; the app needs the backend if you want it
to sync; the podcast step needs an ElevenLabs account.

## How it fits together

1. **Listen** -- a small Python script watches your Pushbullet account and
   appends every link you push to a local file.
2. **Write** -- a Claude Code skill reads that file, fetches each link, and
   writes a prose digest page plus rebuilds a little reading app from it.
3. **Voice** -- a second skill turns the same links into a two-host podcast
   script and sends it through ElevenLabs Text-to-Dialogue.
4. **Read** -- the digest is a static HTML page you can open anywhere, or,
   if you've deployed the backend, it's also in the Expo app on your phone
   or e-ink tablet.

## Setting it up

### 1. Run the listener

The listener needs a Pushbullet account and an access token from
[pushbullet.com/#settings/account](https://www.pushbullet.com/#settings/account).

```
cd pipeline
pip install websocket-client
export PUSHBULLET_TOKEN=your_token_here
python3 pushbullet_bridge.py
```

It backfills anything you pushed today, then listens for new pushes and
appends each link to `~/.daily-dispatch/links.jsonl` (override the base
directory with `DAILY_DISPATCH_HOME`). Leave it running -- as a systemd
service, a `screen`/`tmux` session, or however you keep a long-running
script alive on your machine. There's no systemd unit file in this repo on
purpose: how you supervise a background process is specific to your OS and
setup, not something this project should assume for you.

### 2. Write the digest with Claude

Install the skill, either by cloning this repo and running `claude` inside
it (Claude Code picks up `.claude/skills/` automatically), or from anywhere
with [skills.sh](https://skills.sh)'s installer:

```
npx skills add blbaker/daily-dispatch
```

Then, in a Claude Code session, ask it to run the `daily-digest` skill. For
a test run that doesn't consume your link store:

```
DIGEST_PEEK=1 pipeline/digest_collect.sh
```

The skill reads that output, writes `/tmp/link_digest_YYYYMMDD.md`, renders
it to HTML with `pipeline/md2digest.py`, and rebuilds the reading app with
`pipeline/build_ynd_app.py`. Point a browser at
`$DAILY_DISPATCH_HOME/web/index.html` (defaults to
`~/.daily-dispatch/web/index.html`) to read it.

Summaries are written by whatever `SUMMARIZE_CMD` points at -- it defaults
to `claude -p`, so if you have the Claude Code CLI installed, this works
with no extra setup. Point it at a different CLI (anything that takes a
prompt as its last argument and prints the answer to stdout) if you'd
rather use something else.

Run this on a schedule (cron, a Hermes cron job, anything that can run a
shell command daily) if you want a digest every day without asking for it.

### 3. Voice it with ElevenLabs

Get an API key from [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys)
and export it:

```
export ELEVENLABS_API_KEY=your_key_here
```

Copy `pipeline/voices.example.json` to your own `voices.json` and put in
real voice IDs -- your own cloned voices, or picks from ElevenLabs' shared
Voice Library. Ask Claude to run the `link-talk-podcast` skill, which writes
a script and then:

```
# dry run first -- no API calls, no cost, just a transcript and a char count
python3 pipeline/podcast_make.py --script-dir SCRIPT_DIR --voices voices.json \
  --out out/episode.mp3 --transcript out/episode.md --dry-run

# the real run
python3 pipeline/podcast_make.py --script-dir SCRIPT_DIR --voices voices.json \
  --out out/episode.mp3 --transcript out/episode.md
```

There's a tiny example script at `pipeline/examples/link-talk-script/` you
can run the dry-run command against right away, with no setup, to see the
format and the output.

### 4. Read it in the app

The app works standalone (no backend) if you just want to browse
`web/index.html`. For the native app with sync:

```
cd app
npm install --legacy-peer-deps
cp .env.example .env   # fill in EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY once you've deployed the backend
npm run web              # browser preview
npm run android          # on a connected device or emulator
```

Set `EXPO_PUBLIC_EINK=true` in `.env` for the e-ink (Boox-style) build: same
code, a flattened grayscale theme.

### Deploying the backend (optional)

The backend is an AWS CDK stack: DynamoDB (pay-per-request), a Lambda
behind a Function URL (no API Gateway charge), and an S3 bucket for
self-hosted app updates. It's designed to cost close to nothing for one
user.

```
cd backend
pnpm install
pnpm exec cdk synth    # renders the template locally, no AWS account needed
```

Deploying is a manual, maintainer-run step, never something CI does:

```
export CDK_DEFAULT_ACCOUNT=your_account_id
export CDK_DEFAULT_REGION=us-west-2
pnpm exec cdk deploy -c apiKey="$(openssl rand -hex 32)"
```

Keep the API key you generated (the stack does not print it) -- that's
`EXPO_PUBLIC_API_KEY` in the app and `DIGEST_API_KEY` for the pipeline.
The stack also prints the Function URL, which is `EXPO_PUBLIC_API_URL` /
`DIGEST_API_URL`.

Publishing in-app updates (building and uploading new APKs) is
`scripts/release.sh`, also a manual script -- see its header comment for
what it expects in your environment.

## Environment variables

Everything that used to be hardcoded to one machine is now an environment
variable. The full list, with comments, lives in:

- `.env.pipeline.example` -- the listener, digest, and podcast scripts
- `app/.env.example` -- the app
- `backend/.env.example` -- the CDK deploy

Nothing in this repo needs all of them. The pipeline runs with just
`PUSHBULLET_TOKEN` set; everything else has a sensible default or is
optional.

## Contributing

See `CONTRIBUTING.md` for the fork/branch/PR flow, the commit message
convention this repo uses (it drives automatic versioning), and what CI
checks. Short version: fork it, branch off `main`, open a PR with a
Conventional Commits-style title, and the checks will tell you if something's
broken before a maintainer looks at it.

Please read `CODE_OF_CONDUCT.md` and `SECURITY.md` too -- the first covers
how we expect people to treat each other here, the second is where to
report anything that looks like a security issue rather than a regular bug.

## License

MIT. See `LICENSE`.
