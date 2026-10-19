import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DispatchError } from '../errors.ts';
import { apply, describe, detectKind, JOB_KINDS, jobFiles, osStatus, planInstall, planUninstall } from '../schedule/install.ts';
import { parseEvery } from '../schedule/jobs.ts';
import { defaultPaths, homeDir, resolvePath } from '../schedule/paths.ts';
import { readState } from '../schedule/state.ts';
import type { ExecFn, JobKind, SchedulerIo } from '../schedule/install.ts';
import type { CliIo } from './main.ts';

export const SCHEDULE_HELP = `Usage: daily-dispatch schedule install|uninstall|status [options]

Registers an OS job that runs "daily-dispatch podcast run --if-due" on an
interval. Nothing is scheduled until you run "schedule install". The job
only checks; the podcast's on/off switch, time and time zone live in the
settings (the app's Settings screen, or the config file), so changing the
time there needs no reinstall.

  --every <n>m|<n>h   How often the job checks (default 15m)
  --kind <kind>       systemd, cron, launchd or schtasks (default: launchd on
                      macOS, schtasks on Windows, systemd on Linux when it is
                      running, else cron). Use the same --kind to uninstall.
  --print             Show the files and commands without changing anything
  --config <file>     Passed to the job's podcast run
  --state <file>      Passed to the job's podcast run; the log sits beside it
  --env-file <file>   Passed to the job's podcast run

See docs/daily-podcast.md for each scheduler.`;

const OPTIONS = {
  every: { type: 'string' },
  kind: { type: 'string' },
  print: { type: 'boolean' },
  config: { type: 'string' },
  state: { type: 'string' },
  'env-file': { type: 'string' },
} as const;

const NAMES: Record<JobKind, string> = { systemd: 'systemd user timer', cron: 'cron job', launchd: 'launchd agent', schtasks: 'Task Scheduler task' };

const realExec: ExecFn = (cmd, args, stdin) =>
  new Promise((resolve) => {
    const child = spawn(cmd, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => resolve({ code: 127, stdout, stderr: e.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });

export async function schedule(argv: readonly string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === '-h' || sub === '--help' || rest.includes('--help') || rest.includes('-h')) {
    io.stdout(SCHEDULE_HELP);
    return sub === undefined ? 2 : 0;
  }
  if (sub !== 'install' && sub !== 'uninstall' && sub !== 'status') throw new DispatchError('usage', `unknown schedule command "${sub}"`);
  let flags;
  try {
    flags = parseArgs({ args: rest, options: OPTIONS, strict: true, allowPositionals: false }).values;
  } catch (e) {
    throw new DispatchError('usage', (e as Error).message);
  }
  if (flags.kind !== undefined && !(JOB_KINDS as readonly string[]).includes(flags.kind)) {
    throw new DispatchError('usage', `--kind must be one of: ${JOB_KINDS.join(', ')}`);
  }
  const everyMinutes = parseEvery(flags.every ?? '15m');

  const at = (p: string): string => resolvePath(p, io.cwd, io.env);
  const paths = defaultPaths(io.env);
  const statePath = flags.state !== undefined ? at(flags.state) : paths.state;
  const sio: SchedulerIo = {
    platform: io.platform ?? process.platform,
    env: io.env,
    home: homeDir(io.env),
    configDir: path.dirname(paths.config),
    uid: io.uid ?? process.getuid?.() ?? 0,
    exec: io.exec ?? realExec,
    exists: io.exists ?? ((p) => fs.access(p).then(() => true, () => false)),
  };
  const kind = (flags.kind as JobKind | undefined) ?? (await detectKind(sio));
  const logFile = path.join(path.dirname(statePath), 'podcast.log');

  if (sub === 'status') {
    const os = await osStatus(kind, sio);
    io.stdout(`${os.installed ? `installed: ${NAMES[kind]}` : `not installed (${NAMES[kind]})`}; ${os.detail}`);
    for (const f of jobFiles(kind, sio)) io.stdout(`job file: ${f}`);
    io.stdout(`log: ${logFile}`);
    const days = Object.entries((await readState(statePath)).days).sort(([a], [b]) => (a < b ? 1 : -1));
    for (const [date, d] of days.slice(0, 3)) io.stdout(`${date}: ${d.status} (${d.attempts} attempt${d.attempts === 1 ? '' : 's'})${d.error ? `: ${d.error}` : ''}`);
    if (days.length === 0) io.stdout('no episodes yet');
    return 0;
  }

  const script = path.resolve(io.scriptPath ?? process.argv[1] ?? 'daily-dispatch');
  const pass = (['config', 'state', 'env-file'] as const).flatMap((k) => (flags[k] !== undefined ? [`--${k}`, at(flags[k])] : []));
  const spec = { command: [io.nodePath ?? process.execPath, script, 'podcast', 'run', '--if-due', ...pass], everyMinutes, logFile, path: io.env['PATH'] ?? '' };
  const steps = sub === 'install' ? planInstall(kind, spec, sio) : planUninstall(kind, sio);

  if (flags.print) {
    io.stdout(`${sub} (${NAMES[kind]}) would do this; nothing was changed:\n`);
    for (const line of describe(steps)) io.stdout(line);
    return 0;
  }
  if (sub === 'install') await fs.mkdir(path.dirname(logFile), { recursive: true });
  await apply(steps, sio);
  if (sub === 'uninstall') {
    io.stdout(`removed the ${NAMES[kind]}. Episodes, settings and the log are left in place.`);
    return 0;
  }
  io.stdout(`installed: ${NAMES[kind]}, checking every ${everyMinutes} minutes`);
  io.stdout(`log: ${logFile}`);
  if (script.includes('_npx')) io.stdout('note: this runs from the npx cache, which can be cleared. Install the package globally (npm i -g daily-dispatch) and reinstall the job.');
  if (kind === 'systemd') io.stdout('note: user timers stop when you log out unless lingering is on: loginctl enable-linger "$USER"');
  return 0;
}
