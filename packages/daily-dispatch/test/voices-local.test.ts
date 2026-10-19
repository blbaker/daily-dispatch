import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalVoice } from '../src/voices/local.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeFetch, forbiddenFetch, instantSleep, reply } from './helpers.ts';
import type { Env } from '../src/context.ts';

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 9]);
const voices = { S1: { id: 'af_bella', name: 'Host 1' }, S2: { id: 'am_adam', name: 'Host 2' } };
const ctx = (fetchImpl: typeof fetch, env: Env = {}, model?: string) => ({ env, fetchImpl, sleep: instantSleep, ...(model ? { model } : {}) });

test('local: posts an OpenAI-style speech request to the default Kokoro address', async () => {
  const f = fakeFetch(reply(200, MP3));
  const out = await createLocalVoice(ctx(f.fetch)).synthesize({ turns: [{ speaker: 'S2', text: 'Hi there.' }], voices });
  const [call] = f.calls;
  assert.equal(call?.url, 'http://127.0.0.1:8880/v1/audio/speech');
  assert.equal(call?.method, 'POST');
  assert.deepEqual(call?.json, { model: 'kokoro', voice: 'am_adam', input: 'Hi there.', response_format: 'mp3' });
  assert.equal(call?.headers['authorization'], undefined, 'no key configured means no auth header');
  assert.deepEqual([...out.audio], [...MP3]);
});

test('local: LOCAL_TTS_URL, LOCAL_TTS_MODEL and LOCAL_TTS_API_KEY change the request', async () => {
  const f = fakeFetch(reply(200, MP3), reply(200, MP3));
  const env = { LOCAL_TTS_URL: 'http://tts.lan.test:9000/v1/', LOCAL_TTS_MODEL: 'tts-1', LOCAL_TTS_API_KEY: 'loc' };
  await createLocalVoice(ctx(f.fetch, env)).synthesize({ turns: [{ speaker: 'S1', text: 'One.' }], voices });
  assert.equal(f.calls[0]?.url, 'http://tts.lan.test:9000/v1/audio/speech');
  assert.equal((f.calls[0]?.json as { model: string }).model, 'tts-1');
  assert.equal(f.calls[0]?.headers['authorization'], 'Bearer loc');
  await createLocalVoice(ctx(f.fetch, env, 'kokoro-v2')).synthesize({ turns: [{ speaker: 'S1', text: 'Two.' }], voices });
  assert.equal((f.calls[1]?.json as { model: string }).model, 'kokoro-v2', '--voice-model wins over the env');
});

test('local: free, one speaker per request, tags stripped', () => {
  const p = createLocalVoice(ctx(forbiddenFetch().fetch));
  assert.equal(p.paid, false);
  assert.equal(p.keyEnv, undefined);
  assert.equal(p.capabilities.multiSpeaker, false);
  assert.equal(p.capabilities.costPerChar, 0);
  assert.deepEqual(p.capabilities.supportedTags, []);
});

test('local: a refused connection names the server it tried', async () => {
  const err = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const f = fakeFetch(err, err, err, err);
  await assert.rejects(
    createLocalVoice(ctx(f.fetch)).synthesize({ turns: [{ speaker: 'S1', text: 'x' }], voices }),
    (e) => isDispatchError(e, 'network') && /127\.0\.0\.1:8880/.test(e.message) && /LOCAL_TTS_URL/.test(e.message),
  );
});

test('local: two turns in one request is a programming error, not a silent merge', async () => {
  const p = createLocalVoice(ctx(forbiddenFetch().fetch));
  const two = { turns: [{ speaker: 'S1', text: 'a' }, { speaker: 'S2', text: 'b' }], voices };
  await assert.rejects(p.synthesize(two), (e) => isDispatchError(e, 'invalid-input'));
});
