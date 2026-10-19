import fs from 'node:fs/promises';
import type { spawn } from 'node:child_process';
import { isDispatchError } from '../errors.ts';
import { podcastMake, PODCAST_MAKE_HELP } from './podcast-make.ts';
import { podcastRun, PODCAST_RUN_HELP } from './podcast-run.ts';
import { schedule } from './schedule.ts';
import type { ExecFn } from '../schedule/install.ts';
import type { Env } from '../context.ts';

/** Everything the CLI touches outside itself, injectable for tests. */
export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: Env;
  cwd: string;
  fetchImpl: typeof fetch;
  spawnImpl?: typeof spawn;
  sleep: (ms: number) => Promise<void>;
  /** Clock for the daily schedule. Defaults to the real time. */
  now?: () => Date;
  /** For `schedule`: the OS, scheduler commands and the paths the job will run. Tests fake all of these. */
  platform?: NodeJS.Platform;
  exec?: ExecFn;
  nodePath?: string;
  scriptPath?: string;
  uid?: number;
  exists?: (p: string) => Promise<boolean>;
}

const HELP = `Usage: daily-dispatch <command> [options]

Commands:
  podcast make    Write and voice a podcast episode from a stories file
  podcast run     Make today's episode from the daily podcast settings
                  (--if-due: only when the schedule says so)
  schedule        install, uninstall or show the OS job for the daily episode

Options:
  -h, --help      Show help (also: daily-dispatch podcast make --help)
  -v, --version   Print the version`;

/** Exit codes: 0 ok, 1 the run failed, 2 the input or arguments are wrong. */
const USAGE_KINDS = new Set(['usage', 'invalid-input', 'unknown-provider', 'script-parse', 'turn-too-long']);

async function version(): Promise<string> {
  const pkg = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, sub, ...rest] = argv;
  try {
    if (command === undefined || command === '-h' || command === '--help') {
      io.stdout(HELP);
      return command === undefined ? 2 : 0;
    }
    if (command === '-v' || command === '--version') {
      io.stdout(await version());
      return 0;
    }
    if (command === 'podcast' && sub === 'make') {
      if (rest.includes('-h') || rest.includes('--help')) {
        io.stdout(PODCAST_MAKE_HELP);
        return 0;
      }
      return await podcastMake(rest, io);
    }
    if (command === 'schedule') return await schedule(argv.slice(1), io);
    if (command === 'podcast' && sub === 'run') {
      if (rest.includes('-h') || rest.includes('--help')) {
        io.stdout(PODCAST_RUN_HELP);
        return 0;
      }
      return await podcastRun(rest, io);
    }
    io.stderr(`error: unknown command "${argv.slice(0, 2).join(' ')}"\n\n${HELP}`);
    return 2;
  } catch (e) {
    if (isDispatchError(e)) {
      io.stderr(`error: ${e.message}`);
      for (const d of e.details.slice(0, 15)) if (d !== '') io.stderr(`  ${d}`);
      if (e.kind === 'usage') io.stderr(`\nRun "daily-dispatch ${argv.slice(0, 2).join(' ')} --help" for the options.`);
      return USAGE_KINDS.has(e.kind) ? 2 : 1;
    }
    io.stderr(`error: ${(e as Error).stack ?? String(e)}`);
    return 1;
  }
}
