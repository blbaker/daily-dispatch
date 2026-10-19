import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli/main.ts';
import { detectKind } from '../src/schedule/install.ts';
import type { CliIo } from '../src/cli/main.ts';
import type { ExecFn } from '../src/schedule/install.ts';
import { forbiddenFetch, instantSleep } from './helpers.ts';

const NODE = '/opt/node/bin/node';
const SCRIPT = '/opt/dd/lib/node_modules/daily-dispatch/dist/cli/bin.js';

async function setup(o: { platform?: NodeJS.Platform; crontab?: string; fail?: string } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-sched-'));
  const calls: Array<{ cmd: string; args: readonly string[]; stdin?: string }> = [];
  let crontab = o.crontab ?? '';
  const exec: ExecFn = async (cmd, args, stdin) => {
    calls.push({ cmd, args, ...(stdin !== undefined ? { stdin } : {}) });
    if (o.fail !== undefined && args.includes(o.fail)) return { code: 1, stdout: '', stderr: 'Failed to connect to bus' };
    if (cmd === 'crontab' && args[0] === '-l') return crontab === '' ? { code: 1, stdout: '', stderr: 'no crontab for u' } : { code: 0, stdout: crontab, stderr: '' };
    if (cmd === 'crontab' && args[0] === '-') crontab = stdin ?? '';
    return { code: 0, stdout: 'enabled', stderr: '' };
  };
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    env: { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin' },
    cwd: home,
    fetchImpl: forbiddenFetch().fetch,
    sleep: instantSleep,
    platform: o.platform ?? 'linux',
    exec,
    nodePath: NODE,
    scriptPath: SCRIPT,
    uid: 501,
    exists: async () => true,
  };
  return { home, calls, io, out, text: () => out.join('\n'), errors: () => err.join('\n'), crontab: () => crontab, go: (...a: string[]) => run(['schedule', ...a], io) };
}

const files = async (dir: string): Promise<string[]> => (await fs.readdir(dir, { recursive: true })).map(String).sort();

test('schedule install --print shows every file and command and changes nothing', async () => {
  for (const kind of ['systemd', 'cron', 'launchd', 'schtasks']) {
    const t = await setup();
    assert.equal(await t.go('install', '--print', '--kind', kind), 0, t.errors());
    assert.equal(t.calls.length, 0, `${kind}: --print runs no commands`);
    assert.deepEqual(await files(t.home), [], `${kind}: --print writes no files`);
    assert.ok(t.text().includes(SCRIPT), `${kind}: shows the command it would run`);
    assert.match(t.text(), /podcast(\W|string)+run(\W|string)+--if-due/, `${kind}: the job runs podcast run --if-due`);
  }
});

test('schedule install --kind systemd writes the user units and enables the timer', async () => {
  const t = await setup();
  assert.equal(await t.go('install', '--kind', 'systemd', '--every', '30m'), 0, t.errors());
  const unitDir = path.join(t.home, '.config', 'systemd', 'user');
  assert.match(await fs.readFile(path.join(unitDir, 'daily-dispatch-podcast.timer'), 'utf8'), /OnCalendar=\*:0\/30/);
  const service = await fs.readFile(path.join(unitDir, 'daily-dispatch-podcast.service'), 'utf8');
  assert.ok(service.includes(`ExecStart="${NODE}" "${SCRIPT}" "podcast" "run" "--if-due"`));
  assert.deepEqual(t.calls.map((c) => [c.cmd, ...c.args].join(' ')), ['systemctl --user daemon-reload', 'systemctl --user enable --now daily-dispatch-podcast.timer']);
  assert.match(t.text(), /installed/);
  assert.equal(await t.go('uninstall', '--kind', 'systemd'), 0, t.errors());
  await assert.rejects(fs.access(path.join(unitDir, 'daily-dispatch-podcast.timer')));
  assert.equal([t.calls[2]?.cmd, ...(t.calls[2]?.args ?? [])].join(' '), 'systemctl --user disable --now daily-dispatch-podcast.timer');
});

test('schedule install --kind cron adds one block to the crontab; uninstall restores the original', async () => {
  const theirs = '0 5 * * * /usr/bin/backup\n';
  const t = await setup({ crontab: theirs });
  assert.equal(await t.go('install', '--kind', 'cron'), 0, t.errors());
  assert.ok(t.crontab().startsWith(theirs));
  assert.match(t.crontab(), /^\*\/15 \* \* \* \* PATH='\/usr\/local\/bin:\/usr\/bin:\/bin' '\/opt\/node\/bin\/node' /m);
  assert.equal(await t.go('install', '--kind', 'cron'), 0, t.errors());
  assert.equal(t.crontab().match(/>>> daily-dispatch/g)?.length, 1, 'reinstalling does not duplicate the line');
  assert.equal(await t.go('uninstall', '--kind', 'cron'), 0, t.errors());
  assert.equal(t.crontab(), theirs);
});

test('schedule install --kind launchd writes a LaunchAgent and bootstraps it in the user domain', async () => {
  const t = await setup({ platform: 'darwin' });
  assert.equal(await t.go('install'), 0, t.errors());
  const plist = path.join(t.home, 'Library', 'LaunchAgents', 'dev.daily-dispatch.podcast.plist');
  assert.match(await fs.readFile(plist, 'utf8'), /<integer>900<\/integer>/);
  assert.deepEqual(t.calls.map((c) => [c.cmd, ...c.args].join(' ')), [`launchctl bootout gui/501/dev.daily-dispatch.podcast`, `launchctl bootstrap gui/501 ${plist}`]);
});

test('schedule install --kind schtasks writes UTF-16 task XML and registers it with schtasks', async () => {
  const t = await setup({ platform: 'win32' });
  assert.equal(await t.go('install'), 0, t.errors());
  const xmlFile = path.join(t.home, '.config', 'daily-dispatch', 'daily-dispatch-podcast.xml');
  const bytes = await fs.readFile(xmlFile);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], 'UTF-16LE byte order mark');
  assert.match(bytes.subarray(2).toString('utf16le'), /<Interval>PT15M<\/Interval>/);
  assert.deepEqual(t.calls.map((c) => [c.cmd, ...c.args].join(' ')), [`schtasks /Create /TN DailyDispatch\\Podcast /XML ${xmlFile} /F`]);
});

test('schedule: a failing scheduler command is an error that names the command', async () => {
  const t = await setup({ fail: 'daemon-reload' });
  assert.equal(await t.go('install', '--kind', 'systemd'), 1);
  assert.match(t.errors(), /systemctl --user daemon-reload/);
  assert.match(t.errors(), /Failed to connect to bus/);
});

test('schedule status reports whether the job is installed, where it logs, and the last episode', async () => {
  const t = await setup();
  assert.equal(await t.go('status', '--kind', 'systemd'), 0, t.errors());
  assert.match(t.text(), /not installed/);
  await t.go('install', '--kind', 'systemd');
  const state = path.join(t.home, '.local', 'state', 'daily-dispatch', 'state.json');
  await fs.mkdir(path.dirname(state), { recursive: true });
  await fs.writeFile(state, JSON.stringify({ days: { '2026-10-18': { status: 'done', attempts: 1 }, '2026-10-19': { status: 'failed', attempts: 2, error: 'boom' } } }));
  t.out.length = 0;
  assert.equal(await t.go('status', '--kind', 'systemd'), 0, t.errors());
  assert.match(t.text(), /installed: systemd user timer/);
  assert.match(t.text(), /podcast\.log/);
  assert.match(t.text(), /2026-10-19: failed \(2 attempts\): boom/);
});

test('detectKind: launchd on macOS, Task Scheduler on Windows, systemd when it is running, else cron', async () => {
  const io = (platform: NodeJS.Platform, systemd: boolean) => ({ platform, exists: async (p: string) => systemd && p === '/run/systemd/system' });
  assert.equal(await detectKind(io('darwin', true)), 'launchd');
  assert.equal(await detectKind(io('win32', false)), 'schtasks');
  assert.equal(await detectKind(io('linux', true)), 'systemd');
  assert.equal(await detectKind(io('linux', false)), 'cron');
});

test('schedule with no subcommand or a bad flag is a usage error', async () => {
  const t = await setup();
  assert.equal(await t.go(), 2);
  assert.equal(await t.go('install', '--kind', 'at'), 2);
  assert.equal(await t.go('install', '--every', '7s'), 2);
  assert.equal(t.calls.length, 0);
});
