# Podcast providers

The `daily-dispatch` CLI makes a two-host, call-in style episode from a day's
stories in two steps, and each step is an adapter you pick by name:

- A script writer turns the stories into a script: `anthropic`, `openai`,
  `ollama` or `command`.
- A voice provider reads the script: `elevenlabs`, `openai`, `google`,
  `polly`, `azure` or `local`.

ffmpeg then joins the audio into one MP3 next to a Markdown transcript.

## Install

```sh
npm install -g daily-dispatch
daily-dispatch --help
```

The package is not on npm yet. Until it is, build it from the repository and
run `node packages/daily-dispatch/dist/cli/bin.js` wherever this page says
`daily-dispatch`:

```sh
pnpm install
pnpm --filter daily-dispatch build
```

It needs Node.js 22.18 or newer, and ffmpeg on your `PATH` for audio
(`brew install ffmpeg`, `apt install ffmpeg` or `winget install ffmpeg`). A
dry run works without ffmpeg.

## Make an episode

```sh
daily-dispatch podcast make --stories stories.json \
  --writer ollama --voice local --voices voices.json --out episode/
```

`episode/` then holds `episode.mp3`, `script.txt`, `transcript.md` and a
`chunks/` cache. Run it again after editing `script.txt` with
`--script episode/script.txt` and only the changed chunks are voiced again.

Paid providers never run without `--confirm`. Without it, the CLI still runs
a free writer so you can read the script first, prints the character count
and an estimated cost, and sends nothing to a paid service. Add
`--dry-run` to make sure nothing paid runs even with `--confirm`.

| Option | Meaning |
|---|---|
| `--stories <file>` | An array of stories, or an edition `{"stories": [...]}` |
| `--writer <name>` | `anthropic`, `command`, `ollama` or `openai` |
| `--voice <provider>` | `azure`, `elevenlabs`, `google`, `local`, `openai` or `polly` |
| `--voices <file>` | The voice map, described below |
| `--out <dir>` | Output directory |
| `--script <file>` | Voice an existing script and skip the writer |
| `--minutes <n>` | Target length, default 10 |
| `--model`, `--voice-model` | Writer model and voice model |
| `--writer-command <cmd>` | Command for `--writer command`, default `claude -p` |
| `--style-guide <file>` | Replace the built-in [style guide](podcast-style-guide.md) |

Each story has `headline`, `source`, `summary` and `url`. The writer is told
that every fact must come from those stories.

## Script writers

| Name | Calls | Key | Default model |
|---|---|---|---|
| `anthropic` | Messages API | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| `openai` | Chat Completions API | `OPENAI_API_KEY` | `gpt-6.1-sol` |
| `ollama` | Local `/api/chat` | none | `OLLAMA_MODEL`, or `llama3.1:8b` |
| `command` | Any CLI, prompt on stdin | none | `claude -p` |

`anthropic` and `openai` are paid. `command` counts as free; what it costs is
up to the CLI you point it at. When a model breaks a format rule, the writer
sends the problems back and asks for a corrected script.

## Voice providers

| Name | Service | Key | Voice id example |
|---|---|---|---|
| `elevenlabs` | ElevenLabs Text-to-Dialogue | `ELEVENLABS_API_KEY` | an ElevenLabs voice id |
| `openai` | OpenAI `/v1/audio/speech` | `OPENAI_API_KEY` | `ash` |
| `google` | Gemini multi-speaker TTS | `GEMINI_API_KEY` | `Kore` |
| `polly` | Amazon Polly, neural by default | AWS credentials and `AWS_REGION` | `Ruth` |
| `azure` | Azure AI Speech | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | `en-US-AvaMultilingualNeural` |
| `local` | Any OpenAI-compatible TTS server, such as Kokoro | none | the server's voice name |

`local` talks to `http://127.0.0.1:8880/v1` with the model `kokoro` unless
you set `LOCAL_TTS_URL` and `LOCAL_TTS_MODEL`. Only ElevenLabs keeps audio
tags such as `[laughing]`; the other providers drop them before sending.

Prices, sources and a per-episode estimate for each provider are on the
[Daily episode](daily-podcast.md#costs) page.

## The voice map

`voices.json` maps each speaker tag in the script to a voice:

```json
{
  "S1": { "id": "voice-id", "name": "Host 1" },
  "S2": { "id": "voice-id", "name": "Host 2" },
  "CALLER_A": { "id": "voice-id", "name": "Caller A" }
}
```

`id` is the provider's name for the voice and `name` appears in the
transcript. `S1` and `S2` are the hosts and any other tag is a caller, unless
you set `"role"`. The package ships examples for ElevenLabs and OpenAI in
`packages/daily-dispatch/examples/`. A real run refuses a map that still has
the placeholder ids.

## Environment variables

API keys are read only from the environment, never from a flag or a config
file.

| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | `--writer anthropic` |
| `OPENAI_API_KEY` | `--writer openai`, `--voice openai` |
| `ELEVENLABS_API_KEY` | `--voice elevenlabs` |
| `GEMINI_API_KEY` | `--voice google` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION` | `--voice polly` |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | `--voice azure` |
| `LOCAL_TTS_URL`, `LOCAL_TTS_MODEL`, `LOCAL_TTS_API_KEY` | `--voice local` |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | `--writer ollama`, default `127.0.0.1:11434` |
| `DAILY_DISPATCH_WRITER_COMMAND` | Default for `--writer-command` |
| `LISTENER_NAME`, `LISTENER_TOWN` | Who the hosts say sent the links |
| `FFMPEG_PATH`, `FFPROBE_PATH` | ffmpeg and ffprobe when they are not on `PATH` |

## Add a provider

A voice provider is one file in `packages/daily-dispatch/src/voices/` plus
one line in that folder's `registry.ts`. A script writer is one file in
`src/writers/` plus one line in its registry. The
[package README](../packages/daily-dispatch/README.md) has the two interfaces
and a worked example of each. Tests pass a fake `fetch` and check the
request, so no test calls a real service.

## What has been tested

Every adapter is tested against recorded and faked HTTP responses. The
`ollama` writer and the `local` voice have also made a full episode end to
end with a local model and a local TTS server. No paid
service was called while building the CLI, so the request shapes for
Anthropic, OpenAI, ElevenLabs, Gemini, Polly and Azure come from their API
documentation and have not been tried against the live services.
