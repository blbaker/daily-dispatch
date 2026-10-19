import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createFfmpeg } from '../audio/ffmpeg.ts';
import { DispatchError } from '../errors.ts';
import { makePodcast } from '../podcast.ts';
import { parseScript } from '../script/parse.ts';
import { parseStories } from '../stories.ts';
import { parseVoiceMap } from '../voices-file.ts';
import { getVoiceProvider } from '../voices/registry.ts';
import { getWriter, WRITERS } from '../writers/registry.ts';
import { VOICES } from '../voices/registry.ts';
import type { CliIo } from './main.ts';

export const PODCAST_MAKE_HELP = `Usage: daily-dispatch podcast make --stories <file> --writer <name> --voice <provider>
                                   --voices <voices.json> --out <dir> [options]

Writes a two-host script from the stories, then voices it into <dir>/episode.mp3
with script.txt and transcript.md beside it.

Required:
  --stories <file>        Stories JSON: an array, or an edition {"stories": [...]}
  --writer <name>         Script writer: ${Object.keys(WRITERS).sort().join(', ')}
  --voice <provider>      Voice provider: ${Object.keys(VOICES).sort().join(', ')}
  --voices <file>         voices.json: {"S1": {"id": "...", "name": "..."}, ...}
  --out <dir>             Output directory (chunks are cached here between runs)

Options:
  --dry-run               Never call a paid provider; print characters and cost
  --confirm               Allow paid providers. Without it, paid runs are dry runs
  --script <file>         Use this script instead of running a writer
                          (then --stories and --writer are not needed)
  --minutes <n>           Target length in minutes (default 10)
  --title <text>          Show title (default "Link Talk")
  --model <id>            Writer model (anthropic, openai, ollama)
  --voice-model <id>      Voice model (elevenlabs: eleven_v4, openai: gpt-4o-mini-tts)
  --writer-command <cmd>  Command for --writer command (default "claude -p")
  --style-guide <file>    Replace the built-in style guide
  --listener-name <name>  Who sent the links (default: LISTENER_NAME)
  --listener-town <town>  Where they live (default: LISTENER_TOWN)

Environment:
  ANTHROPIC_API_KEY       --writer anthropic
  OPENAI_API_KEY          --writer openai, --voice openai
  ELEVENLABS_API_KEY      --voice elevenlabs
  OLLAMA_HOST             Ollama server (default 127.0.0.1:11434)
  OLLAMA_MODEL            Ollama model (default llama3.1:8b)
  DAILY_DISPATCH_WRITER_COMMAND  Default for --writer-command
  LISTENER_NAME, LISTENER_TOWN   Default framing for the show
  FFMPEG_PATH, FFPROBE_PATH      ffmpeg binaries if they are not on PATH`;

const OPTIONS = {
  stories: { type: 'string' },
  writer: { type: 'string' },
  voice: { type: 'string' },
  voices: { type: 'string' },
  out: { type: 'string' },
  'dry-run': { type: 'boolean' },
  confirm: { type: 'boolean' },
  script: { type: 'string' },
  minutes: { type: 'string' },
  title: { type: 'string' },
  model: { type: 'string' },
  'voice-model': { type: 'string' },
  'writer-command': { type: 'string' },
  'style-guide': { type: 'string' },
  'listener-name': { type: 'string' },
  'listener-town': { type: 'string' },
} as const;

async function readJsonFile(file: string, what: string): Promise<unknown> {
  const text = await fs.readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
    throw new DispatchError('invalid-input', `cannot read ${what} file ${file}: ${e.code ?? e.message}`);
  });
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new DispatchError('invalid-input', `${what} file ${file} is not valid JSON: ${(e as Error).message}`);
  }
}

export async function podcastMake(argv: readonly string[], io: CliIo): Promise<number> {
  let flags;
  try {
    flags = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (e) {
    throw new DispatchError('usage', (e as Error).message);
  }
  const usingScript = flags.script !== undefined;
  type Required = 'voice' | 'voices' | 'out' | 'stories' | 'writer';
  const required: Required[] = ['voice', 'voices', 'out', ...(usingScript ? [] : (['stories', 'writer'] as const))];
  const missing = required.filter((k) => flags[k] === undefined);
  if (missing.length > 0) throw new DispatchError('usage', `missing ${missing.map((k) => `--${k}`).join(', ')}`);
  const minutes = flags.minutes === undefined ? 10 : Number(flags.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new DispatchError('usage', '--minutes must be a positive number');

  const at = (p: string): string => path.resolve(io.cwd, p);
  const base = { env: io.env, fetchImpl: io.fetchImpl, sleep: io.sleep, ...(io.spawnImpl ? { spawnImpl: io.spawnImpl } : {}) };
  const writer = getWriter(flags.writer ?? 'command', {
    ...base,
    ...(flags.model !== undefined ? { model: flags.model } : {}),
    ...(flags['writer-command'] !== undefined ? { command: flags['writer-command'] } : {}),
  });
  const voice = getVoiceProvider(flags.voice!, { ...base, ...(flags['voice-model'] !== undefined ? { model: flags['voice-model'] } : {}) });
  const voices = parseVoiceMap(await readJsonFile(at(flags.voices!), 'voices'));
  const title = flags.title ?? 'Link Talk';
  const script = usingScript ? parseScript(await fs.readFile(at(flags.script!), 'utf8'), Object.keys(voices), title) : undefined;
  const stories = flags.stories === undefined ? [] : parseStories(await readJsonFile(at(flags.stories), 'stories'));

  const paid = [...(usingScript ? [] : [writer]), voice].filter((p) => p.paid).map((p) => p.name);
  const dryRun = flags['dry-run'] === true || (paid.length > 0 && flags.confirm !== true);
  if (dryRun && flags['dry-run'] !== true) {
    io.stdout(`dry run: ${paid.join(' and ')} ${paid.length > 1 ? 'are paid providers' : 'is a paid provider'}, so nothing is sent to ${paid.length > 1 ? 'them' : 'it'}. Re-run with --confirm to generate the episode.`);
  }

  const listener = {
    name: flags['listener-name'] ?? io.env['LISTENER_NAME'] ?? '',
    town: flags['listener-town'] ?? io.env['LISTENER_TOWN'] ?? '',
  };
  const result = await makePodcast({
    stories,
    voices,
    writer,
    voice,
    outDir: at(flags.out!),
    dryRun,
    ffmpeg: createFfmpeg({ env: io.env, ...(io.spawnImpl ? { spawnImpl: io.spawnImpl } : {}) }),
    env: io.env,
    log: io.stdout,
    title,
    listener,
    minutes,
    ...(script !== undefined ? { script } : {}),
    ...(flags['style-guide'] !== undefined ? { styleGuide: await fs.readFile(at(flags['style-guide']), 'utf8') } : {}),
  });
  for (const [what, file] of Object.entries(result.files)) io.stdout(`${what}: ${file}`);
  return 0;
}
