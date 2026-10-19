import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli/main.ts';
import type { CliIo } from '../src/cli/main.ts';
import { REQ, fakeFetch, fakeSpawn, instantSleep, reply } from './helpers.ts';

const SCRIPT = '## Open\nS1: Hello there.\nS2: Hi, my brother.\n';
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1]);
const VOICES = { S1: { id: 'af_bella', name: 'Bella' }, S2: { id: 'am_adam', name: 'Adam' } };
const PODCAST = { enabled: true, time: '06:30', timezone: 'America/Chicago', writer: 'command', voice: 'local', voices: VOICES };

async function setup(o: { podcast?: object; config?: object; env?: Record<string, string>; replies?: Array<Response | Error>; now: string; digest?: string }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-run-'));
  const cfgDir = path.join(home, '.config', 'daily-dispatch');
  await fs.mkdir(cfgDir, { recursive: true });
  const config = { podcast: { ...PODCAST, ...o.podcast }, stories: 'digest-{date}.json', ...o.config };
  await fs.writeFile(path.join(cfgDir, 'config.json'), JSON.stringify(config));
  await fs.writeFile(path.join(cfgDir, `digest-${o.digest ?? '2026-10-19'}.json`), JSON.stringify({ stories: REQ.stories }));
  const f = fakeFetch(...(o.replies ?? [reply(200, MP3), reply(200, MP3)]));
  const s = fakeSpawn({ stdout: SCRIPT });
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    env: { HOME: home, ...o.env },
    cwd: home,
    fetchImpl: f.fetch,
    spawnImpl: s.spawn,
    sleep: instantSleep,
    now: () => new Date(o.now),
  };
  const state = path.join(home, '.local', 'state', 'daily-dispatch', 'state.json');
  const readState = async () => JSON.parse(await fs.readFile(state, 'utf8')) as { days: Record<string, { status: string; attempts: number; episode?: string }> };
  return { home, f, s, io, text: () => out.join('\n'), errors: () => err.join('\n'), readState, state, go: (...a: string[]) => run(['podcast', 'run', '--if-due', ...a], io) };
}

const writerCalls = (s: ReturnType<typeof fakeSpawn>) => s.calls.filter((c) => c.command === 'claude').length;

test('podcast run --if-due: disabled does nothing at all', async () => {
  const t = await setup({ podcast: { enabled: false }, now: '2026-10-19T15:00:00Z' });
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /not due: disabled/);
  assert.equal(t.s.calls.length + t.f.calls.length, 0);
  await assert.rejects(fs.access(t.state), 'no state file is written');
});

test('podcast run --if-due: before the local time does nothing', async () => {
  const t = await setup({ now: '2026-10-19T11:29:00Z' }); // 06:29 in Chicago
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /not due: before-time/);
  assert.equal(t.s.calls.length + t.f.calls.length, 0);
});

test('podcast run --if-due: due makes the episode, records the date, and the next poll does nothing', async () => {
  const t = await setup({ now: '2026-10-19T11:31:00Z' });
  assert.equal(await t.go(), 0, t.errors());
  assert.equal(writerCalls(t.s), 1);
  assert.equal(t.f.calls.length, 2, 'one local TTS request per turn');
  assert.equal(t.f.calls[0]?.url, 'http://127.0.0.1:8880/v1/audio/speech');
  const day = (await t.readState()).days['2026-10-19'];
  assert.equal(day?.status, 'done');
  assert.match(day?.episode ?? '', /2026-10-19[\\/]episode\.mp3$/);
  const spawned = t.s.calls.length;
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /not due: already-done/);
  assert.equal(t.s.calls.length, spawned, 'already done: nothing ran');
  assert.equal(t.f.calls.length, 2);
});

test('podcast run --if-due: the episode date is the local date, read from the matching digest', async () => {
  // 06:45Z on Oct 20 is 23:45 on Oct 19 in Los Angeles.
  const t = await setup({ podcast: { time: '23:30', timezone: 'America/Los_Angeles' }, now: '2026-10-20T06:45:00Z', digest: '2026-10-19' });
  assert.equal(await t.go(), 0, t.errors());
  assert.equal((await t.readState()).days['2026-10-19']?.status, 'done');
});

test('podcast run --if-due: no digest for the date yet means wait, without using up an attempt', async () => {
  const t = await setup({ now: '2026-10-19T11:31:00Z', digest: '2026-10-18' });
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /waiting: no stories for 2026-10-19/);
  assert.equal(writerCalls(t.s), 0);
  await assert.rejects(fs.access(t.state));
});

test('podcast run --if-due: settings and stories come from the backend when it is configured', async () => {
  const settings = { podcast: { enabled: true, time: '05:00', timezone: 'UTC', voiceProvider: 'local', scriptWriter: 'command', hostVoices: { Bella: 'af_bella', Adam: 'am_adam' } } };
  const env = { DAILY_DISPATCH_API_URL: 'https://api.example.test', DAILY_DISPATCH_API_KEY: 'k' };
  const t = await setup({ config: { stories: undefined }, env, now: '2026-10-19T05:10:00Z', replies: [reply(200, settings), reply(200, { id: '2026-10-19', inProgress: false, stories: REQ.stories }), reply(200, MP3), reply(200, MP3)] });
  assert.equal(await t.go(), 0, t.errors());
  assert.deepEqual(t.f.calls.slice(0, 2).map((c) => c.url), ['https://api.example.test/settings', 'https://api.example.test/editions/2026-10-19']);
  assert.equal(t.f.calls[1]?.headers['x-api-key'], 'k');
  assert.equal((await t.readState()).days['2026-10-19']?.status, 'done');
});

test('podcast run --if-due: an edition still in progress, or missing, means wait', async () => {
  const settings = { podcast: { enabled: true, time: '05:00', timezone: 'UTC', voiceProvider: 'local', scriptWriter: 'command', hostVoices: { Bella: 'af_bella' } } };
  const env = { DAILY_DISPATCH_API_URL: 'https://api.example.test', DAILY_DISPATCH_API_KEY: 'k' };
  const t = await setup({ config: { stories: undefined }, env, now: '2026-10-19T05:10:00Z', replies: [reply(200, settings), reply(200, { inProgress: true, stories: REQ.stories }), reply(200, settings), reply(404, { error: 'not found' })] });
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /still in progress/);
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /no edition for 2026-10-19/);
  assert.equal(writerCalls(t.s), 0);
});

test('podcast run --if-due: a paid provider without confirm refuses before spending; "confirm": true allows it', async () => {
  const t = await setup({ podcast: { voice: 'openai' }, env: { OPENAI_API_KEY: 'sk' }, now: '2026-10-19T12:00:00Z' });
  assert.equal(await t.go(), 2);
  assert.match(t.errors(), /paid/);
  assert.match(t.errors(), /"confirm": true/);
  assert.equal(t.s.calls.length + t.f.calls.length, 0);
  const ok = await setup({ podcast: { voice: 'openai' }, config: { confirm: true }, env: { OPENAI_API_KEY: 'sk' }, now: '2026-10-19T12:00:00Z' });
  assert.equal(await ok.go(), 0, ok.errors());
  assert.equal(ok.f.calls[0]?.url, 'https://api.openai.com/v1/audio/speech');
});

test('podcast run --if-due: failures count attempts, a retry reuses the script, and three failures stop the day', async () => {
  const fail = () => Array.from({ length: 4 }, () => reply(500, 'boom'));
  const t = await setup({ now: '2026-10-19T12:00:00Z', replies: [...fail(), ...fail(), ...fail()] });
  for (let i = 1; i <= 3; i++) {
    assert.equal(await t.go(), 1);
    assert.equal((await t.readState()).days['2026-10-19']?.attempts, i);
  }
  assert.equal(writerCalls(t.s), 1, 'the script from the first attempt was reused');
  assert.equal(await t.go(), 0);
  assert.match(t.text(), /not due: gave-up/);
  assert.equal(await run(['podcast', 'run', '--force'], t.io), 1, '--force tries again (and fails again here, with no replies left)');
});

test('podcast run --if-due: a run already in progress (lock file) makes the next poll skip', async () => {
  const t = await setup({ now: '2026-10-19T12:00:00Z' });
  await fs.mkdir(path.dirname(t.state), { recursive: true });
  await fs.writeFile(`${t.state}.lock`, String(process.pid));
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /another run is in progress/);
  assert.equal(t.s.calls.length, 0);
});

test('podcast run --if-due stamps each line with the time; --log appends them, and the error, to a file', async () => {
  const t = await setup({ podcast: { enabled: false }, now: '2026-10-19T15:00:00Z' });
  const log = path.join(t.home, 'logs', 'podcast.log');
  assert.equal(await t.go('--log', log), 0, t.errors());
  assert.equal(await t.go('--log', log), 0, t.errors());
  assert.match(t.text(), /^2026-10-19T15:00:00\.000Z not due: disabled/m);
  const lines = (await fs.readFile(log, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2, 'appended, not overwritten');
  assert.match(lines[0] ?? '', /^2026-10-19T15:00:00\.000Z not due: disabled/);
  const bad = await setup({ podcast: { voice: 'openai' }, env: { OPENAI_API_KEY: 'sk' }, now: '2026-10-19T12:00:00Z' });
  const badLog = path.join(bad.home, 'podcast.log');
  assert.equal(await bad.go('--log', badLog), 2);
  assert.match(await fs.readFile(badLog, 'utf8'), /^2026-10-19T12:00:00\.000Z error: openai is a paid provider/m);
});
