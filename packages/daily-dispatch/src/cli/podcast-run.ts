import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DispatchError } from '../errors.ts';
import { loadConfig, withEnvFile } from '../schedule/config.ts';
import { defaultPaths, resolvePath } from '../schedule/paths.ts';
import { runPodcast } from '../schedule/run.ts';
import type { CliIo } from './main.ts';

export const PODCAST_RUN_HELP = `Usage: daily-dispatch podcast run [--if-due] [options]

Makes today's episode from the day's stories, using the daily podcast
settings: the backend's /settings when DAILY_DISPATCH_API_URL and
DAILY_DISPATCH_API_KEY are set (what the app's Settings screen saves),
otherwise the "podcast" section of the config file. At most one episode is
made per local date; the state file remembers which dates are done.

With those two variables set, a new episode is also uploaded to the backend,
which tells the app it is ready. A failed upload exits 1, and the next run
retries just the upload.

  --if-due            Do nothing unless the podcast is enabled, the local time
                      is past the set time, and today has no episode yet. The
                      scheduled job runs this every 15 minutes.
  --force             Make the episode even if the state file says it is done
  --date <YYYY-MM-DD> Make this date's episode instead of today's
  --dry-run           Never call a paid provider; print characters and cost
  --confirm           Allow paid providers (or "confirm": true in the config)
  --config <file>     Config file (default ~/.config/daily-dispatch/config.json)
  --state <file>      State file (default ~/.local/state/daily-dispatch/state.json)
  --out <dir>         Episodes go in <dir>/<date>/ (default ~/.local/share/daily-dispatch/episodes)
  --stories <file>    Local digest instead of the backend; {date} becomes YYYY-MM-DD
  --env-file <file>   KEY=VALUE file loaded first (default ~/.config/daily-dispatch/env)
  --log <file>        Also append each line, with the time, to this file

Exit codes: 0 made, not due, or waiting for stories; 1 the run failed;
2 the settings or arguments are wrong. See docs/daily-podcast.md.`;

const OPTIONS = {
  'if-due': { type: 'boolean' },
  force: { type: 'boolean' },
  date: { type: 'string' },
  'dry-run': { type: 'boolean' },
  confirm: { type: 'boolean' },
  config: { type: 'string' },
  state: { type: 'string' },
  out: { type: 'string' },
  stories: { type: 'string' },
  'env-file': { type: 'string' },
  log: { type: 'string' },
} as const;

export async function podcastRun(argv: readonly string[], io: CliIo): Promise<number> {
  let flags;
  try {
    flags = parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (e) {
    throw new DispatchError('usage', (e as Error).message);
  }
  if (flags['if-due'] && flags.date !== undefined) throw new DispatchError('usage', '--date cannot be combined with --if-due');

  const at = (p: string): string => resolvePath(p, io.cwd, io.env);
  const clock = io.now ?? (() => new Date());
  const now = clock();
  // A scheduled run's output lands in a log, where each line needs its time.
  const stamped = flags['if-due'] === true || flags.log !== undefined;
  const lines: string[] = [];
  const log = (line: string): void => {
    const ts = clock().toISOString();
    io.stdout(stamped ? `${ts} ${line}` : line);
    lines.push(`${ts} ${line}`);
  };
  try {
    return await runWith(flags, io, at, now, log);
  } catch (e) {
    lines.push(`${clock().toISOString()} error: ${(e as Error).message}`);
    throw e;
  } finally {
    if (flags.log !== undefined) {
      const file = at(flags.log);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, lines.map((l) => `${l}\n`).join(''));
    }
  }
}

type Flags = ReturnType<typeof parseArgs<{ args: string[]; options: typeof OPTIONS; strict: true; allowPositionals: false }>>['values'];

async function runWith(flags: Flags, io: CliIo, at: (p: string) => string, now: Date, log: (line: string) => void): Promise<number> {
  const defaults = defaultPaths(io.env);
  const env = await withEnvFile(io.env, flags['env-file'] !== undefined ? at(flags['env-file']) : defaults.envFile);
  const configPath = flags.config !== undefined ? at(flags.config) : defaults.config;
  const config = await loadConfig(configPath, flags.config !== undefined);
  const configDir = config.dir ?? io.cwd;
  const storiesFile = flags.stories !== undefined ? at(flags.stories) : config.stories !== undefined ? resolvePath(config.stories, configDir, env) : undefined;

  await runPodcast({
    ifDue: flags['if-due'] === true,
    force: flags.force === true,
    dryRun: flags['dry-run'] === true,
    confirm: flags.confirm === true,
    ...(flags.date !== undefined ? { date: flags.date } : {}),
    config,
    configPath,
    statePath: flags.state !== undefined ? at(flags.state) : defaults.state,
    outDir: flags.out !== undefined ? at(flags.out) : config.out !== undefined ? resolvePath(config.out, configDir, env) : defaults.out,
    ...(storiesFile !== undefined ? { storiesFile } : {}),
    env,
    fetchImpl: io.fetchImpl,
    ...(io.spawnImpl ? { spawnImpl: io.spawnImpl } : {}),
    sleep: io.sleep,
    now,
    log,
  });
  // Not due, waiting for stories and another run in progress are all normal
  // for a job that polls; failures throw and exit non-zero.
  return 0;
}
