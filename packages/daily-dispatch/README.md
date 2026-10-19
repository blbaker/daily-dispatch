# daily-dispatch

Turns a day's links into a two-host, call-in style podcast episode. A script
writer (Claude, OpenAI, a local Ollama model, or any CLI) writes the show from
your stories, then a voice provider (ElevenLabs or OpenAI) reads it, and
ffmpeg joins the pieces into one MP3 with a Markdown transcript.

Both halves are adapters behind small interfaces, so adding a model or a
voice service is one file plus one line in a registry.

## Install

Needs Node.js 22 or newer, and ffmpeg on your `PATH` to produce audio
(`brew install ffmpeg`, `apt install ffmpeg`, `winget install ffmpeg`).
A dry run works without ffmpeg.

```sh
npm install -g daily-dispatch
daily-dispatch --help
```

Or run it once without installing: `npx daily-dispatch --help`.

From this repository:

```sh
pnpm install
pnpm --filter daily-dispatch build
node packages/daily-dispatch/dist/cli/bin.js --help
```

## Quick start

The package ships example inputs in `examples/`. This dry run sends nothing
anywhere and prints the character count and an estimated cost:

```sh
daily-dispatch podcast make \
  --stories examples/stories.example.json \
  --writer anthropic --voice elevenlabs \
  --voices examples/voices.elevenlabs.example.json \
  --out episode/
```

Paid providers always start as a dry run. A dry run still runs free writers
(Ollama and the command writer), so you can read `episode/script.txt` and
`episode/transcript.md` before paying for any audio. With a paid writer, it
saves the exact prompt to `episode/prompt.txt` instead.

To generate audio, set the provider's key and add `--confirm`:

```sh
export ELEVENLABS_API_KEY=...        # from your password manager, not a file
daily-dispatch podcast make --stories stories.json --writer ollama \
  --voice elevenlabs --voices voices.json --out episode/ --confirm
```

Output in `episode/`: `episode.mp3`, `script.txt`, `transcript.md`, and a
`chunks/` cache. Rerunning after a script edit only re-voices the chunks
whose text changed.

## Options

```
--stories <file>        Stories JSON: an array, or an edition {"stories": [...]}
--writer <name>         anthropic, command, ollama, openai
--voice <provider>      elevenlabs, openai
--voices <file>         voices.json (see below)
--out <dir>             Output directory
--dry-run               Never call a paid provider
--confirm               Allow paid providers
--script <file>         Voice an existing script; skips the writer
--minutes <n>           Target length, default 10
--title <text>          Show title, default "Link Talk"
--model <id>            Writer model
--voice-model <id>      Voice model
--writer-command <cmd>  Command for --writer command, default "claude -p"
--style-guide <file>    Replace the built-in style guide
--listener-name, --listener-town   Who sent the links
```

Exit codes: `0` success, `1` the run failed (network, provider, ffmpeg),
`2` the arguments or input files are wrong.

## Inputs

**Stories.** Each story has `headline`, `source`, `summary` and `url`.
`summary` may be a string or a list of paragraphs. Duplicate URLs are dropped
and each summary is trimmed to about 350 characters before it reaches the
writer. The prompt tells the writer that every fact must come from these
stories.

**voices.json** maps a speaker tag to a voice:

```json
{
  "S1": { "id": "voice-id", "name": "Host 1" },
  "S2": { "id": "voice-id", "name": "Host 2" },
  "CALLER_A": { "id": "voice-id", "name": "Caller A" }
}
```

`id` is whatever the provider uses: an ElevenLabs voice id, or an OpenAI
voice name such as `ash`. `name` appears in the transcript. Tags like `S1`
and `S2` are hosts and every other tag is a caller, unless you set
`"role": "host"` or `"role": "caller"`. Optional per-voice fields:

- `settings`, `model` (ElevenLabs): voice settings or a model for this voice
  only. Text-to-Dialogue takes one model and one set of settings for every
  speaker, so a map that uses either field is voiced one turn at a time
  through the text-to-speech endpoint instead.
- `instructions` (OpenAI): how the voice should speak.

A real run refuses a voice map that still contains the example placeholder
ids.

**Script format.** The writer's output, `script.txt`, and `--script` input
all use the same format:

```
## Segment title
S1: [laughing] A line of dialogue.
S2: Another line.
```

The parser rejects unknown speaker tags, a turn that is only an audio tag
(ElevenLabs answers those with HTTP 400), two speakers on one line, and any
other line. When a model breaks a rule, the writer sends the problems back
and asks for a corrected script. Most writers get two attempts; Ollama gets
three.

## Script writers

| Name | Runs | Key | Default model |
|------|------|-----|---------------|
| `anthropic` | Messages API | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| `openai` | Chat Completions API | `OPENAI_API_KEY` | `gpt-6.1-sol` |
| `ollama` | local `/api/chat` | none | `OLLAMA_MODEL` or `llama3.1:8b` |
| `command` | any CLI, prompt on stdin | none | `claude -p` |

`anthropic` and `openai` are paid and never run without `--confirm`.
`ollama` sizes the context window to the prompt, because Ollama's default
window would cut a day's stories short. `command` counts as free: whatever
the CLI costs is between you and that CLI.

## Voice providers

| Name | Request | Max chars per request | Audio tags | Estimate |
|------|---------|-----------------------|------------|----------|
| `elevenlabs` | Text-to-Dialogue, several speakers per request | 1,900 | all | $0.08 per 1,000 chars |
| `openai` | `/v1/audio/speech`, one turn per request | 4,096 | stripped | about $0.015 per 1,000 chars |

Turns are grouped into requests on line boundaries, never across a segment,
and never past a provider's character or unique-voice limit. A turn longer
than the limit is an error that names the turn. The cost figures are list
prices checked on 2026-10-19 (elevenlabs.io/pricing/api and OpenAI's
gpt-4o-mini-tts pricing); a subscription plan may cost less per character.
Before voicing, the ElevenLabs adapter checks the account's remaining
characters and stops if the episode needs more.

## The two interfaces

```ts
interface ScriptWriter {
  readonly name: string;
  readonly paid: boolean;              // paid writers need --confirm
  readonly keyEnv?: string;            // env var holding the key
  readonly price?: { inputPerMTok: number; outputPerMTok: number; source: string };
  write(req: WriteRequest, signal?: AbortSignal): Promise<Script>;
}

interface VoiceProvider {
  readonly name: string;
  readonly paid: boolean;
  readonly keyEnv?: string;
  readonly capabilities: VoiceCapabilities; // multiSpeaker, maxCharsPerRequest,
                                            // maxVoicesPerRequest, supportedTags, costPerChar
  readonly costSource: string;              // where costPerChar comes from
  capabilitiesFor?(voices: VoiceMap): VoiceCapabilities;
  requestKey(req: SynthesisRequest): unknown;  // hashed for the chunk cache
  synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult>;
  preflight?(chars: number): Promise<void>;    // fail before spending
}
```

A `Script` is `{ title, segments: [{ title, turns: [{ speaker, text }] }] }`.

## Adding a provider

A voice provider is one file and one registry line. Use the shared HTTP
helper so retries (409, 429 and 5xx, with backoff) and error messages match
the other adapters:

```ts
// src/voices/acme.ts
import { readAudio, requireKey, sendJson } from '../http.ts';
import type { SynthesisRequest, VoiceFactory } from './types.ts';

// One turn per request, so the body is the voice and that turn's text.
const body = (req: SynthesisRequest) => ({ voice: req.voices[req.turns[0]!.speaker]!.id, text: req.turns[0]!.text });

export const createAcmeVoice: VoiceFactory = (ctx) => ({
  name: 'acme',
  paid: true,
  keyEnv: 'ACME_API_KEY',
  capabilities: { multiSpeaker: false, maxCharsPerRequest: 3000, maxVoicesPerRequest: 1, supportedTags: [], costPerChar: 0.00002 },
  costSource: 'acme.example/pricing, checked YYYY-MM-DD',
  requestKey: body,
  async synthesize(req, signal) {
    const key = requireKey(ctx.env, 'ACME_API_KEY', 'acme');
    const res = await sendJson(
      'https://api.acme.example/v1/speech',
      { headers: { authorization: `Bearer ${key}` }, body: body(req) },
      { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'acme', keyEnv: 'ACME_API_KEY', ...(signal ? { signal } : {}) },
    );
    return { audio: await readAudio(res, 'acme') };
  },
});
```

```ts
// src/voices/registry.ts
export const VOICES = {
  acme: createAcmeVoice, // the one new line
  elevenlabs: createElevenLabsVoice,
  openai: createOpenAIVoice,
};
```

A script writer only needs a function that sends a prompt and returns text.
`textWriter` adds the prompt, output cleanup, parsing and the retry:

```ts
// src/writers/acme.ts
export const createAcmeWriter: WriterFactory = (ctx) =>
  textWriter({ name: 'acme', paid: true, keyEnv: 'ACME_API_KEY' }, async (prompt, signal) => {
    // send prompt.system and prompt.user, return the model's text
  });
```

Then add `acme: createAcmeWriter` to `WRITERS` in `src/writers/registry.ts`.
Read the key with `requireKey` inside the request function, not in the
factory, so a dry run works without it. Tests pass a fake `fetchImpl` and
check the request shape; see `test/voices.test.ts` and `test/writers.test.ts`.

## Environment variables

| Variable | Used by |
|----------|---------|
| `ANTHROPIC_API_KEY` | `--writer anthropic` |
| `OPENAI_API_KEY` | `--writer openai`, `--voice openai` |
| `ELEVENLABS_API_KEY` | `--voice elevenlabs` |
| `OLLAMA_HOST` | Ollama server, `host:port` or a URL. Default `127.0.0.1:11434` |
| `OLLAMA_MODEL` | Ollama model. Default `llama3.1:8b` |
| `DAILY_DISPATCH_WRITER_COMMAND` | Default for `--writer-command` |
| `LISTENER_NAME`, `LISTENER_TOWN` | Who the hosts say sent the links |
| `FFMPEG_PATH`, `FFPROBE_PATH` | ffmpeg and ffprobe if they are not on `PATH` |

API keys are read only from the environment. There is no flag or config file
for them.

## Library use

```ts
import { createFfmpeg, getVoiceProvider, getWriter, makePodcast, parseStories, parseVoiceMap } from 'daily-dispatch';

const ctx = { env: process.env, fetchImpl: fetch, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
const result = await makePodcast({
  stories: parseStories(storiesJson),
  voices: parseVoiceMap(voicesJson),
  writer: getWriter('ollama', ctx),
  voice: getVoiceProvider('elevenlabs', ctx),
  outDir: 'episode',
  dryRun: true,
  ffmpeg: createFfmpeg({ env: process.env }),
  env: process.env,
  log: console.log,
});
console.log(result.estimate.totalUsd);
```

Every failure is a `DispatchError` with a `kind` (`no-key`, `unauthorized`,
`rate-limited`, `script-parse`, `ffmpeg-missing`, and so on) so callers can
explain each cause.

## Development

```sh
pnpm test         # node:test, no network: fetch and spawn are faked
pnpm typecheck
pnpm build
pnpm mutate       # break one rule at a time and check that its test fails
```

Tests run straight from the TypeScript sources, which needs Node 22.18 or
newer. One test in `test/assemble.test.ts` runs the real ffmpeg when it is
installed and is skipped otherwise.
