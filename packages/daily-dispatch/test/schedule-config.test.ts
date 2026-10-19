import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, parseEnvFile, resolveSettings } from '../src/schedule/config.ts';
import { defaultPaths } from '../src/schedule/paths.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeFetch, forbiddenFetch, reply } from './helpers.ts';

const BACKEND = {
  notifications: { enabled: true, newEdition: true, newEpisode: true },
  podcast: { enabled: true, time: '07:15', timezone: 'America/Denver', voiceProvider: 'google', scriptWriter: 'anthropic', hostVoices: { Ava: 'Kore', Sam: 'Puck' } },
  updatedAt: '2026-10-19T12:00:00.000Z',
};
const API = { DAILY_DISPATCH_API_URL: 'https://api.example.test/', DAILY_DISPATCH_API_KEY: 'k1' };

async function configFile(data: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dd-cfg-'));
  const file = path.join(dir, 'config.json');
  await fs.writeFile(file, JSON.stringify(data));
  return { dir, file };
}

test('paths: XDG variables win, otherwise ~/.config and ~/.local/state under HOME', () => {
  const p = defaultPaths({ HOME: '/h' });
  assert.equal(p.config, path.join('/h', '.config', 'daily-dispatch', 'config.json'));
  assert.equal(p.state, path.join('/h', '.local', 'state', 'daily-dispatch', 'state.json'));
  assert.equal(p.out, path.join('/h', '.local', 'share', 'daily-dispatch', 'episodes'));
  const x = defaultPaths({ HOME: '/h', XDG_CONFIG_HOME: '/c', XDG_STATE_HOME: '/s', XDG_DATA_HOME: '/d' });
  assert.equal(x.config, path.join('/c', 'daily-dispatch', 'config.json'));
  assert.equal(x.state, path.join('/s', 'daily-dispatch', 'state.json'));
  assert.equal(x.out, path.join('/d', 'daily-dispatch', 'episodes'));
  assert.equal(defaultPaths({ USERPROFILE: 'C:\\Users\\me' }).config, path.join('C:\\Users\\me', '.config', 'daily-dispatch', 'config.json'));
});

test('settings come from the backend when DAILY_DISPATCH_API_URL and the key are set', async () => {
  const f = fakeFetch(reply(200, BACKEND));
  const { file } = await configFile({ podcast: { enabled: false, time: '01:00', timezone: 'UTC', writer: 'ollama', voice: 'local' } });
  const s = await resolveSettings({ env: API, config: await loadConfig(file, true), fetchImpl: f.fetch });
  assert.equal(f.calls[0]?.url, 'https://api.example.test/settings');
  assert.equal(f.calls[0]?.headers['x-api-key'], 'k1');
  assert.equal(s.source, 'backend');
  assert.deepEqual(
    { enabled: s.enabled, time: s.time, timezone: s.timezone, writer: s.writer, voice: s.voice },
    { enabled: true, time: '07:15', timezone: 'America/Denver', writer: 'anthropic', voice: 'google' },
  );
  assert.deepEqual(s.voices, { S1: { id: 'Kore', name: 'Ava' }, S2: { id: 'Puck', name: 'Sam' } });
});

test('without the backend, settings come from the local config file', async () => {
  const { file } = await configFile({ podcast: { enabled: true, time: '06:00', timezone: 'Europe/Berlin', writer: 'ollama', voice: 'local', voices: { S1: { id: 'af_bella', name: 'Bella' } } } });
  const s = await resolveSettings({ env: {}, config: await loadConfig(file, true), fetchImpl: forbiddenFetch().fetch });
  assert.equal(s.source, 'config');
  assert.deepEqual({ enabled: s.enabled, time: s.time, timezone: s.timezone, writer: s.writer, voice: s.voice }, { enabled: true, time: '06:00', timezone: 'Europe/Berlin', writer: 'ollama', voice: 'local' });
  assert.deepEqual(s.voices, { S1: { id: 'af_bella', name: 'Bella' } });
});

test('a voices path is read relative to the config file; backend host voices fall back to it when empty', async () => {
  const { dir, file } = await configFile({ podcast: { voices: 'voices.json' } });
  await fs.writeFile(path.join(dir, 'voices.json'), JSON.stringify({ S1: { id: 'v1', name: 'One' } }));
  const empty = { ...BACKEND, podcast: { ...BACKEND.podcast, hostVoices: {} } };
  const s = await resolveSettings({ env: API, config: await loadConfig(file, true), fetchImpl: fakeFetch(reply(200, empty)).fetch });
  assert.deepEqual(s.voices, { S1: { id: 'v1', name: 'One' } });
});

test('backend errors are explicit: a rejected key names the variable', async () => {
  const f = fakeFetch(reply(401, { error: 'unauthorized' }));
  await assert.rejects(resolveSettings({ env: API, config: {}, fetchImpl: f.fetch }), (e) => isDispatchError(e, 'unauthorized') && /DAILY_DISPATCH_API_KEY/.test(e.message));
});

test('nothing configured anywhere is an error that says where to configure it', async () => {
  await assert.rejects(resolveSettings({ env: {}, config: {}, fetchImpl: forbiddenFetch().fetch, configPath: '/x/config.json' }), (e) => isDispatchError(e, 'invalid-input') && /\/x\/config\.json/.test(e.message) && /DAILY_DISPATCH_API_URL/.test(e.message));
});

test('loadConfig: a missing default file is empty, a missing explicit file is an error, bad JSON is an error', async () => {
  assert.deepEqual(await loadConfig('/nonexistent/dd/config.json', false), {});
  await assert.rejects(loadConfig('/nonexistent/dd/config.json', true), (e) => isDispatchError(e, 'invalid-input'));
  const { file } = await configFile({});
  await fs.writeFile(file, '{ nope');
  await assert.rejects(loadConfig(file, false), (e) => isDispatchError(e, 'invalid-input') && /not valid JSON/.test(e.message));
});

test('env file: KEY=VALUE lines with comments and quotes; the real environment wins', () => {
  const parsed = parseEnvFile('# keys\nGEMINI_API_KEY="g 1"\n\nexport AZURE_SPEECH_REGION=eastus\nBAD LINE\nOPENAI_API_KEY=\'o=1\'\n');
  assert.deepEqual(parsed, { GEMINI_API_KEY: 'g 1', AZURE_SPEECH_REGION: 'eastus', OPENAI_API_KEY: 'o=1' });
});
