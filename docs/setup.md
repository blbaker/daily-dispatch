# Get started

Daily Dispatch is a set of parts, each of which runs on its own. This page
gets each one running on your machine with sample data. None of the
commands here need an account, an API key or a deployed backend.

- The app (`app/`) shows the day's edition on a phone, an e-ink tablet, the
  web and the desktop.
- The `daily-dispatch` CLI (`packages/daily-dispatch/`) writes a two-host
  podcast script from the day's stories and voices it.
- The pipeline (`pipeline/`) captures the links you push from your phone and
  turns them into the day's digest.
- The backend (`backend/`) stores editions, episodes, settings and push
  devices on AWS. You only need it to sync the app across devices or to get
  push notifications.

## Prerequisites

- Git
- Node.js 24. The CLI alone needs 22.18 or newer.
- pnpm 10 or newer
- Python 3.12 or newer, for the pipeline
- ffmpeg, only when you make podcast audio
- JDK 17 and an Android SDK, only when you build the Android app

Clone the repository:

```sh
git clone https://github.com/blbaker/daily-dispatch.git
cd daily-dispatch
```

## Open the desktop app with sample editions

The quickest way to see the app is the desktop build. It starts a local mock
of the backend that serves three sample editions.

```sh
cd app
npm run desktop:install
npm run desktop:demo
```

This works on macOS (Apple silicon), Linux x64 and Windows x64. Linux needs
an X11 or XWayland session and Mesa; [Desktop](desktop.md) lists the
packages.

## Run the app in a browser

```sh
cd app
npm install --legacy-peer-deps
cp .env.example .env
npm run web
```

With `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_API_KEY` empty, the app opens
but shows "API not configured". Fill them in once you have a backend (see
[Backend](backend.md)). Set `EXPO_PUBLIC_EINK=true` for the e-ink build,
which uses a flat grayscale theme.

`npm run android` and `npm run ios` build and start the native app on a
device or emulator. They need the Android SDK or Xcode.

## Make a podcast script without spending anything

Build the CLI from the workspace and run it on the bundled example stories:

```sh
pnpm install
pnpm --filter @blbaker/daily-dispatch build
node packages/daily-dispatch/dist/cli/bin.js podcast make \
  --stories packages/daily-dispatch/examples/stories.example.json \
  --writer anthropic --voice elevenlabs \
  --voices packages/daily-dispatch/examples/voices.elevenlabs.example.json \
  --out /tmp/episode
```

Both providers in that command are paid, so the CLI calls neither. It saves
the prompt the writer would get to `/tmp/episode/prompt.txt` and prints the
character count and an estimated cost. Swap in `--writer ollama` and
`--voice local` to make a full episode for free with a local Ollama model and
a local TTS server. [Podcast providers](podcast-providers.md) covers every
option.

## Check the pipeline

```sh
python3 -m unittest discover -s tests
python3 pipeline/podcast_make.py --script-dir pipeline/examples/link-talk-script \
  --voices pipeline/voices.example.json \
  --out /tmp/episode.mp3 --transcript /tmp/episode.md --dry-run
```

The dry run parses the example script, writes the transcript and prints the
character count. It never calls ElevenLabs. [Pipeline](pipeline.md) explains
how to capture real links and write a digest.

## Next steps

- [Pipeline](pipeline.md): capture links and write the daily digest.
- [Backend](backend.md): deploy the AWS stack so the app can sync.
- [Daily episode](daily-podcast.md): make a podcast at the same time every
  day.
- [Push setup](push-setup.md): turn on notifications for a new edition or
  episode.
- [Desktop](desktop.md): package the desktop app for macOS, Linux or Windows.
