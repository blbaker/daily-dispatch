import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli/main.ts';
import type { CliIo } from '../src/cli/main.ts';
import type { DayRecord } from '../src/schedule/clock.ts';
import { REQ, fakeFetch, fakeSpawn, instantSleep, reply } from './helpers.ts';

const SCRIPT = '## Open\nS1: Hello there.\nS2: Hi, my brother.\n';
const TTS = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1]);
/** What the fake ffmpeg writes as the finished episode, so the upload has real bytes to send. */
const EPISODE = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 7, 7]);
const API = 'https://api.example.test';
const BACKEND = { DAILY_DISPATCH_API_URL: API, DAILY_DISPATCH_API_KEY: 'k' };
const PUT_URL = 'https://media.example.test/episodes/2026-10-19.mp3?X-Amz-Signature=abc';
const VOICES = { S1: { id: 'af_bella', name: 'Bella' }, S2: { id: 'am_adam', name: 'Adam' } };
const PODCAST = { enabled: true, time: '05:00', timezone: 'UTC', writer: 'command', voice: 'local', voices: VOICES };
const SETTINGS = { podcast: { enabled: true, time: '05:00', timezone: 'UTC', voiceProvider: 'local', scriptWriter: 'command', hostVoices: { Bella: 'af_bella', Adam: 'am_adam' } } };

const settings = () => reply(200, SETTINGS);
/** GET /settings, then one local TTS request per turn. */
const made = () => [settings(), reply(200, TTS), reply(200, TTS)];
const created = () => reply(200, { ok: true, upload: { url: PUT_URL, method: 'PUT', headers: { 'content-type': 'audio/mpeg' }, expiresIn: 3600 } });
const ready = () => reply(200, { ok: true, episode: { id: '2026-10-19', status: 'ready' }, push: { recorded: true, sent: 2 } });
const uploaded = () => [created(), reply(200, ''), ready()];

/** The writer prints the script, ffprobe reports 612.4 s, and the final ffmpeg call writes EPISODE. */
function studio() {
  const writer = fakeSpawn({ stdout: SCRIPT });
  const probe = fakeSpawn({ stdout: '612.4\n' });
  const spawn = ((command: string, args: readonly string[] = [], opts?: object) => {
    const out = args.at(-1);
    if (command === 'ffmpeg' && out?.endsWith('episode.mp3')) writeFileSync(out, EPISODE);
    return (command === 'ffprobe' ? probe : writer).spawn(command, args, opts as never);
  }) as unknown as typeof writer.spawn;
  return { spawn, writerCalls: () => writer.calls.filter((c) => c.command === 'claude').length };
}

async function setup(o: { env?: Record<string, string>; replies: Array<Response | Error>; days?: (home: string) => Promise<Record<string, DayRecord>> }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-up-'));
  const cfgDir = path.join(home, '.config', 'daily-dispatch');
  await fs.mkdir(cfgDir, { recursive: true });
  await fs.writeFile(path.join(cfgDir, 'config.json'), JSON.stringify({ podcast: PODCAST, stories: 'digest-{date}.json' }));
  await fs.writeFile(path.join(cfgDir, 'digest-2026-10-19.json'), JSON.stringify({ stories: REQ.stories }));
  const state = path.join(home, '.local', 'state', 'daily-dispatch', 'state.json');
  if (o.days !== undefined) {
    await fs.mkdir(path.dirname(state), { recursive: true });
    await fs.writeFile(state, JSON.stringify({ days: await o.days(home) }));
  }
  const f = fakeFetch(...o.replies);
  const s = studio();
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
    now: () => new Date('2026-10-19T05:10:00Z'),
  };
  const day = async () => (JSON.parse(await fs.readFile(state, 'utf8')) as { days: Record<string, DayRecord> }).days['2026-10-19'];
  return { home, f, s, io, day, state, text: () => out.join('\n'), errors: () => err.join('\n'), go: (...a: string[]) => run(['podcast', 'run', '--if-due', ...a], io) };
}

test('upload: with the backend set, a new episode is posted, PUT to the presigned URL, then marked ready', async () => {
  const t = await setup({ env: BACKEND, replies: [...made(), ...uploaded()] });
  assert.equal(await t.go(), 0, t.errors());
  assert.equal(t.f.calls.length, 6);
  const [meta, put, done] = t.f.calls.slice(3);
  assert.equal(meta?.url, `${API}/episodes`);
  assert.equal(meta?.method, 'POST');
  assert.equal(meta?.headers['x-api-key'], 'k');
  assert.deepEqual(meta?.json, { id: '2026-10-19', date: '2026-10-19', title: 'Link Talk: Monday, October 19, 2026', contentType: 'audio/mpeg', durationSec: 612 });
  assert.equal(put?.url, PUT_URL);
  assert.equal(put?.method, 'PUT');
  assert.equal(put?.headers['content-type'], 'audio/mpeg');
  assert.equal(put?.headers['x-api-key'], undefined, 'the API key never goes to the storage host');
  assert.deepEqual(put?.bytes, EPISODE);
  assert.equal(done?.url, `${API}/episodes`);
  assert.equal(done?.headers['x-api-key'], 'k');
  assert.deepEqual(done?.json, { id: '2026-10-19', ready: true });
  const day = await t.day();
  assert.equal(day?.status, 'done');
  assert.equal(day?.upload?.status, 'done');
  assert.match(t.text(), /uploaded the 2026-10-19 episode/);
});

test('upload: after a successful upload, later runs and a manual run upload nothing', async () => {
  const t = await setup({ env: BACKEND, replies: [...made(), ...uploaded(), settings(), settings()] });
  assert.equal(await t.go(), 0, t.errors());
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /not due: already-done/);
  assert.equal(await run(['podcast', 'run'], t.io), 0, t.errors());
  assert.deepEqual(t.f.calls.slice(6).map((c) => c.url), [`${API}/settings`, `${API}/settings`], 'only the settings were read again');
  assert.equal((await t.day())?.upload?.attempts, 1);
});

test('upload: a failed PUT exits 1, keeps the day done, and the next run retries only the upload', async () => {
  const denied = reply(403, '<Error><Code>AccessDenied</Code></Error>');
  const t = await setup({ env: BACKEND, replies: [...made(), created(), denied, settings(), ...uploaded()] });
  assert.equal(await t.go(), 1);
  assert.match(t.errors(), /the 2026-10-19 episode was made, but uploading it failed/);
  assert.match(t.errors(), /HTTP 403/);
  assert.match(t.errors(), /the next run tries the upload again/);
  let day = await t.day();
  assert.equal(day?.status, 'done', 'the writer and voice are not run again');
  assert.equal(day?.attempts, 1);
  assert.equal(day?.upload?.status, 'pending');
  assert.equal(day?.upload?.attempts, 1);
  assert.match(day?.upload?.error ?? '', /HTTP 403/);

  assert.equal(await t.go(), 0, t.errors());
  assert.equal(t.s.writerCalls(), 1);
  assert.equal(t.f.calls.filter((c) => c.url.includes('127.0.0.1')).length, 2, 'no turn was voiced twice');
  assert.deepEqual(t.f.calls.slice(5).map((c) => `${c.method} ${c.url}`), [`GET ${API}/settings`, `POST ${API}/episodes`, `PUT ${PUT_URL}`, `POST ${API}/episodes`]);
  day = await t.day();
  assert.equal(day?.upload?.status, 'done');
  assert.equal(day?.upload?.attempts, 2);
  assert.equal(day?.upload?.error, undefined);
});

test('upload: without both DAILY_DISPATCH_API_URL and DAILY_DISPATCH_API_KEY nothing is uploaded', async () => {
  for (const env of [{}, { DAILY_DISPATCH_API_URL: API }, { DAILY_DISPATCH_API_KEY: 'k' }] as Array<Record<string, string>>) {
    const t = await setup({ env, replies: [reply(200, TTS), reply(200, TTS)] });
    assert.equal(await t.go(), 0, t.errors());
    assert.deepEqual(t.f.calls.map((c) => new URL(c.url).host), ['127.0.0.1:8880', '127.0.0.1:8880'], 'only the local TTS server');
    const day = await t.day();
    assert.equal(day?.status, 'done');
    assert.equal(day?.upload, undefined, JSON.stringify(env));
  }
});

/** A made episode whose upload is still pending, as an earlier failed run leaves it. */
const pendingDay = (file: (home: string) => Promise<string>) => async (home: string): Promise<Record<string, DayRecord>> => ({
  '2026-10-19': { status: 'done', attempts: 1, episode: await file(home), durationSec: 612, upload: { status: 'pending', attempts: 1, error: 'HTTP 503' } },
});
const onDisk = async (home: string) => {
  const file = path.join(home, 'episodes', '2026-10-19', 'episode.mp3');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, EPISODE);
  return file;
};

test('upload: an episode file that is gone gives up once, saying how to remake it, instead of failing every run', async () => {
  const t = await setup({ env: BACKEND, replies: [settings(), settings()], days: pendingDay(async (home) => path.join(home, 'gone', 'episode.mp3')) });
  assert.equal(await t.go(), 1);
  assert.match(t.errors(), /episode\.mp3 no longer exists/);
  assert.match(t.errors(), /podcast run --force --date 2026-10-19/);
  assert.equal((await t.day())?.upload?.status, 'gave-up');
  assert.equal(await t.go(), 0, t.errors());
  assert.deepEqual(t.f.calls.map((c) => c.url), [`${API}/settings`, `${API}/settings`], 'nothing was posted for a file that cannot be sent');
});

test('upload: a dry run, or a run while another holds the lock, leaves a pending upload alone', async () => {
  const t = await setup({ env: BACKEND, replies: [settings(), settings()], days: pendingDay(onDisk) });
  assert.equal(await t.go('--dry-run'), 0, t.errors());
  assert.match(t.text(), /dry run: the 2026-10-19 upload is still pending/);
  await fs.writeFile(`${t.state}.lock`, String(process.pid));
  assert.equal(await t.go(), 0, t.errors());
  assert.match(t.text(), /upload skipped: another run is in progress/);
  assert.deepEqual(t.f.calls.map((c) => c.url), [`${API}/settings`, `${API}/settings`]);
  assert.equal((await t.day())?.upload?.attempts, 1);
});

test('upload: a backend refusal is explained, stops before the PUT, and leaves the upload pending', async () => {
  const cases: Array<[Response, RegExp]> = [
    [reply(401, { error: 'forbidden' }), /rejected the API key \(HTTP 401\)\. Check DAILY_DISPATCH_API_KEY/],
    [reply(503, { error: 'no media bucket configured' }), /HTTP 503 for \/episodes: .*no media bucket configured/],
    [reply(200, { ok: true }), /POST \/episodes returned no upload URL/],
  ];
  for (const [answer, why] of cases) {
    const t = await setup({ env: BACKEND, replies: [settings(), answer], days: pendingDay(onDisk) });
    assert.equal(await t.go(), 1);
    assert.match(t.errors(), why);
    assert.equal((await t.day())?.upload?.status, 'pending');
    assert.equal(t.f.calls.length, 2, 'stopped before the PUT');
  }
});
