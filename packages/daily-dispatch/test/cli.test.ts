import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli/main.ts';
import type { CliIo } from '../src/cli/main.ts';
import { REQ, fakeSpawn, forbiddenFetch, instantSleep } from './helpers.ts';

const SCRIPT = '## Open\nS1: Hello there.\nS2: Hi, my brother.\n';

async function setup(env: Record<string, string> = {}, spawnOut = SCRIPT) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-cli-'));
  await fs.writeFile(path.join(dir, 'stories.json'), JSON.stringify({ stories: REQ.stories }));
  await fs.writeFile(path.join(dir, 'voices.json'), JSON.stringify(REQ.voices));
  await fs.writeFile(path.join(dir, 'script.txt'), SCRIPT);
  const f = forbiddenFetch();
  const s = fakeSpawn({ stdout: spawnOut });
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    env,
    cwd: dir,
    fetchImpl: f.fetch,
    spawnImpl: s.spawn,
    sleep: instantSleep,
  };
  const make = (...extra: string[]) =>
    run(['podcast', 'make', '--stories', 'stories.json', '--voices', 'voices.json', '--out', 'out', ...extra], io);
  return { dir, f, s, io, make, text: () => out.join('\n'), errors: () => err.join('\n') };
}

const KEYS = { ANTHROPIC_API_KEY: 'sk', ELEVENLABS_API_KEY: 'xi', OPENAI_API_KEY: 'oa' };

test('--version prints the package version and --help lists the commands', async () => {
  const t = await setup();
  assert.equal(await run(['--version'], t.io), 0);
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(t.text(), pkg.version);
  assert.equal(await run(['--help'], t.io), 0);
  assert.match(t.text(), /podcast make/);
});

test('podcast make --help documents every flag and env var', async () => {
  const t = await setup();
  assert.equal(await run(['podcast', 'make', '--help'], t.io), 0);
  for (const s of ['--stories', '--writer', '--voice ', '--voices', '--out', '--dry-run', '--confirm', '--script', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OLLAMA_HOST', 'GEMINI_API_KEY', 'AWS_REGION', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'LOCAL_TTS_URL']) {
    assert.ok(t.text().includes(s), `help mentions ${s}`);
  }
});

test('paid providers default to a dry run: estimate printed, no network', async () => {
  const t = await setup(KEYS);
  const code = await t.make('--writer', 'anthropic', '--voice', 'elevenlabs');
  assert.equal(code, 0, t.errors());
  assert.equal(t.f.state.called, 0, 'fetch must not be called');
  assert.match(t.text(), /dry run/i);
  assert.match(t.text(), /--confirm/);
  assert.match(t.text(), /estimated cost: writer \$\d+\.\d\d \+ voice \$\d+\.\d\d/);
  await fs.access(path.join(t.dir, 'out', 'prompt.txt'));
});

test('--dry-run wins over --confirm', async () => {
  const t = await setup(KEYS);
  assert.equal(await t.make('--writer', 'openai', '--voice', 'openai', '--confirm', '--dry-run'), 0, t.errors());
  assert.equal(t.f.state.called, 0);
});

test('--confirm with a missing key fails before any request, naming the variable', async () => {
  const t = await setup({ ELEVENLABS_API_KEY: 'xi' });
  assert.equal(await t.make('--writer', 'anthropic', '--voice', 'elevenlabs', '--confirm'), 1);
  assert.match(t.errors(), /ANTHROPIC_API_KEY/);
  assert.equal(t.f.state.called, 0);
  assert.equal(t.s.calls.length, 0, 'not even ffmpeg ran');
});

test('a free writer still runs in a dry run, so the script and transcript exist', async () => {
  const t = await setup();
  assert.equal(await t.make('--writer', 'command', '--voice', 'elevenlabs'), 0, t.errors());
  assert.equal(t.s.calls[0]?.command, 'claude');
  assert.equal(t.f.state.called, 0);
  assert.match(await fs.readFile(path.join(t.dir, 'out', 'transcript.md'), 'utf8'), /\*\*Host 1:\*\* Hello there\./);
});

test('--script skips the writer and needs neither --stories nor --writer', async () => {
  const t = await setup();
  const code = await run(['podcast', 'make', '--script', 'script.txt', '--voice', 'openai', '--voices', 'voices.json', '--out', 'out'], t.io);
  assert.equal(code, 0, t.errors());
  assert.equal(t.s.calls.length, 0);
  assert.match(t.text(), /chunks=2 chars=27/);
});

test('usage errors exit 2 and say what is wrong', async () => {
  const t = await setup();
  assert.equal(await run(['podcast', 'make', '--writer', 'ollama', '--voice', 'openai'], t.io), 2);
  assert.match(t.errors(), /--stories/);
  assert.equal(await t.make('--writer', 'gemini', '--voice', 'openai'), 2);
  assert.match(t.errors(), /unknown script writer "gemini"/);
  assert.equal(await run(['podcast', 'make', '--bogus'], t.io), 2);
  assert.equal(await run(['nope'], t.io), 2);
});

test('a malformed stories file exits 2 with the problems listed', async () => {
  const t = await setup();
  await fs.writeFile(path.join(t.dir, 'stories.json'), JSON.stringify([{ headline: 7 }]));
  assert.equal(await t.make('--writer', 'ollama', '--voice', 'openai'), 2);
  assert.match(t.errors(), /story 1/);
});
