import fs from 'node:fs/promises';
import path from 'node:path';
import { DispatchError } from '../errors.ts';
import { mergeCrontab, renderCronBlock, renderLaunchd, renderSchtasks, renderSystemd } from './jobs.ts';
import type { Env } from '../context.ts';
import type { JobSpec } from './jobs.ts';

export type JobKind = 'systemd' | 'cron' | 'launchd' | 'schtasks';
export const JOB_KINDS: readonly JobKind[] = ['systemd', 'cron', 'launchd', 'schtasks'];
export const UNIT = 'daily-dispatch-podcast';
export const LABEL = 'dev.daily-dispatch.podcast';
export const TASK = 'DailyDispatch\\Podcast';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type ExecFn = (cmd: string, args: readonly string[], stdin?: string) => Promise<ExecResult>;

export interface SchedulerIo {
  platform: NodeJS.Platform;
  env: Env;
  home: string;
  /** Directory of the default config file; the Task Scheduler XML is kept there. */
  configDir: string;
  uid: number;
  exec: ExecFn;
  exists: (p: string) => Promise<boolean>;
}

export type Step =
  | { kind: 'write'; path: string; content: string; utf16?: boolean }
  | { kind: 'remove'; path: string }
  | { kind: 'run'; cmd: string; args: string[]; mayFail?: boolean }
  | { kind: 'crontab'; block: string | null };

/** The scheduler this machine uses. systemd counts only when it is the running init (sd_booted). */
export async function detectKind(io: Pick<SchedulerIo, 'platform' | 'exists'>): Promise<JobKind> {
  if (io.platform === 'darwin') return 'launchd';
  if (io.platform === 'win32') return 'schtasks';
  return (await io.exists('/run/systemd/system')) ? 'systemd' : 'cron';
}

export function jobFiles(kind: JobKind, io: Pick<SchedulerIo, 'env' | 'home' | 'configDir'>): string[] {
  const unitDir = path.join(io.env['XDG_CONFIG_HOME']?.trim() || path.join(io.home, '.config'), 'systemd', 'user');
  if (kind === 'systemd') return [path.join(unitDir, `${UNIT}.service`), path.join(unitDir, `${UNIT}.timer`)];
  if (kind === 'launchd') return [path.join(io.home, 'Library', 'LaunchAgents', `${LABEL}.plist`)];
  if (kind === 'schtasks') return [path.join(io.configDir, `${UNIT}.xml`)];
  return [];
}

export function planInstall(kind: JobKind, spec: JobSpec, io: SchedulerIo): Step[] {
  const files = jobFiles(kind, io);
  if (kind === 'systemd') {
    const { service, timer } = renderSystemd(spec);
    return [
      { kind: 'write', path: files[0]!, content: service },
      { kind: 'write', path: files[1]!, content: timer },
      { kind: 'run', cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
      { kind: 'run', cmd: 'systemctl', args: ['--user', 'enable', '--now', `${UNIT}.timer`] },
    ];
  }
  if (kind === 'launchd') {
    return [
      { kind: 'write', path: files[0]!, content: renderLaunchd(spec, LABEL) },
      // Unload an earlier copy first; bootstrap refuses a label that is already loaded.
      { kind: 'run', cmd: 'launchctl', args: ['bootout', `gui/${io.uid}/${LABEL}`], mayFail: true },
      { kind: 'run', cmd: 'launchctl', args: ['bootstrap', `gui/${io.uid}`, files[0]!] },
    ];
  }
  if (kind === 'schtasks') {
    return [
      { kind: 'write', path: files[0]!, content: renderSchtasks(spec), utf16: true },
      { kind: 'run', cmd: 'schtasks', args: ['/Create', '/TN', TASK, '/XML', files[0]!, '/F'] },
    ];
  }
  return [{ kind: 'crontab', block: renderCronBlock(spec) }];
}

export function planUninstall(kind: JobKind, io: SchedulerIo): Step[] {
  const files = jobFiles(kind, io);
  const remove = files.map((p): Step => ({ kind: 'remove', path: p }));
  if (kind === 'systemd') {
    return [{ kind: 'run', cmd: 'systemctl', args: ['--user', 'disable', '--now', `${UNIT}.timer`], mayFail: true }, ...remove, { kind: 'run', cmd: 'systemctl', args: ['--user', 'daemon-reload'] }];
  }
  if (kind === 'launchd') return [{ kind: 'run', cmd: 'launchctl', args: ['bootout', `gui/${io.uid}/${LABEL}`], mayFail: true }, ...remove];
  if (kind === 'schtasks') return [{ kind: 'run', cmd: 'schtasks', args: ['/Delete', '/TN', TASK, '/F'], mayFail: true }, ...remove];
  return [{ kind: 'crontab', block: null }];
}

/** What --print shows: every file with its content, every command, in order. */
export function describe(steps: readonly Step[]): string[] {
  return steps.map((s) => {
    if (s.kind === 'write') return `write ${s.path}${s.utf16 ? ' (UTF-16)' : ''}:\n${s.content}`;
    if (s.kind === 'remove') return `remove ${s.path}`;
    if (s.kind === 'run') return `run: ${[s.cmd, ...s.args].join(' ')}${s.mayFail ? '   (a failure here is ignored)' : ''}`;
    return s.block === null ? 'crontab: remove the daily-dispatch block' : `crontab: add or replace the daily-dispatch block:\n${s.block}`;
  });
}

async function mustRun(io: SchedulerIo, cmd: string, args: readonly string[], stdin?: string): Promise<ExecResult> {
  const r = await io.exec(cmd, args, stdin);
  if (r.code !== 0) throw new DispatchError('command-failed', `${[cmd, ...args].join(' ')} exited ${r.code}: ${r.stderr.trim().slice(0, 300)}`);
  return r;
}

async function readCrontab(io: SchedulerIo): Promise<string> {
  const r = await io.exec('crontab', ['-l']);
  if (r.code === 0) return r.stdout;
  if (/no crontab/i.test(r.stderr)) return '';
  throw new DispatchError('command-failed', `crontab -l exited ${r.code}: ${r.stderr.trim().slice(0, 300)}`);
}

export async function apply(steps: readonly Step[], io: SchedulerIo): Promise<void> {
  for (const s of steps) {
    if (s.kind === 'write') {
      await fs.mkdir(path.dirname(s.path), { recursive: true });
      await fs.writeFile(s.path, s.utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s.content, 'utf16le')]) : s.content);
    } else if (s.kind === 'remove') {
      await fs.unlink(s.path).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    } else if (s.kind === 'run') {
      if (s.mayFail) await io.exec(s.cmd, s.args);
      else await mustRun(io, s.cmd, s.args);
    } else {
      await mustRun(io, 'crontab', ['-'], mergeCrontab(await readCrontab(io), s.block));
    }
  }
}

/** One line on whether the OS has the job, from the scheduler itself where it can say. */
export async function osStatus(kind: JobKind, io: SchedulerIo): Promise<{ installed: boolean; detail: string }> {
  if (kind === 'cron') {
    const installed = (await readCrontab(io)).includes('daily-dispatch podcast (managed');
    return { installed, detail: installed ? 'cron entry present' : 'no cron entry' };
  }
  const files = jobFiles(kind, io);
  const present = (await Promise.all(files.map((f) => fs.access(f).then(() => true, () => false)))).every(Boolean);
  if (!present) return { installed: false, detail: 'no job files' };
  const query =
    kind === 'systemd'
      ? await io.exec('systemctl', ['--user', 'is-enabled', `${UNIT}.timer`])
      : kind === 'launchd'
        ? await io.exec('launchctl', ['print', `gui/${io.uid}/${LABEL}`])
        : await io.exec('schtasks', ['/Query', '/TN', TASK, '/FO', 'LIST']);
  const first = (query.stdout || query.stderr).trim().split('\n')[0] ?? '';
  return { installed: true, detail: `${query.code === 0 ? 'scheduler reports' : 'scheduler query failed'}: ${first}` };
}
