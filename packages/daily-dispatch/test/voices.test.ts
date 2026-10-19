import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElevenLabsVoice } from '../src/voices/elevenlabs.ts';
import { createOpenAIVoice } from '../src/voices/openai.ts';
import { getVoiceProvider, VOICES } from '../src/voices/registry.ts';
import { effectiveCapabilities } from '../src/voices/types.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeFetch, forbiddenFetch, instantSleep, reply } from './helpers.ts';
import type { VoiceMap } from '../src/types.ts';

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1, 2, 3]);
const VOICES_MAP: VoiceMap = { S1: { id: 'el-1', name: 'Host 1' }, S2: { id: 'el-2', name: 'Host 2' } };
const env = { ELEVENLABS_API_KEY: 'xi-key', OPENAI_API_KEY: 'sk-oa' };
const ctx = (fetchImpl: typeof fetch, model?: string) => ({ env, fetchImpl, sleep: instantSleep, ...(model ? { model } : {}) });
const turns = [
  { speaker: 'S1', text: '[laughing] Hello there.' },
  { speaker: 'S2', text: 'Hi, my brother.' },
];

test('elevenlabs: one Text-to-Dialogue request carries every turn', async () => {
  const f = fakeFetch(reply(200, MP3, { 'character-cost': '38' }));
  const out = await createElevenLabsVoice(ctx(f.fetch)).synthesize({ turns, voices: VOICES_MAP });
  const [call] = f.calls;
  assert.equal(call?.url, 'https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128');
  assert.equal(call?.method, 'POST');
  assert.equal(call?.headers['xi-api-key'], 'xi-key');
  assert.deepEqual(call?.json, {
    model_id: 'eleven_v4',
    settings: { stability: 0.5 },
    seed: 1979,
    inputs: [
      { text: '[laughing] Hello there.', voice_id: 'el-1' },
      { text: 'Hi, my brother.', voice_id: 'el-2' },
    ],
  });
  assert.deepEqual([...out.audio], [...MP3]);
  assert.equal(out.billedChars, 38);
});

test('elevenlabs: capabilities match the production limits', () => {
  const p = createElevenLabsVoice(ctx(forbiddenFetch().fetch));
  assert.deepEqual(p.capabilities, { multiSpeaker: true, maxCharsPerRequest: 1900, maxVoicesPerRequest: 10, supportedTags: 'all', costPerChar: 0.00008 });
  assert.equal(p.paid, true);
  assert.equal(p.keyEnv, 'ELEVENLABS_API_KEY');
});

test('elevenlabs: a voice with its own settings or model switches to per-turn text-to-speech', async () => {
  const p = createElevenLabsVoice(ctx(forbiddenFetch().fetch));
  assert.equal(effectiveCapabilities(p, VOICES_MAP).multiSpeaker, true);
  const tuned: VoiceMap = { ...VOICES_MAP, S2: { id: 'el-2', name: 'Host 2', settings: { stability: 0.3, speed: 1.1 } } };
  assert.equal(effectiveCapabilities(p, tuned).multiSpeaker, false);
  const withModel: VoiceMap = { ...VOICES_MAP, S1: { id: 'el-1', name: 'Host 1', model: 'eleven_multilingual_v2' } };
  assert.equal(effectiveCapabilities(p, withModel).maxVoicesPerRequest, 1);

  const f = fakeFetch(reply(200, MP3), reply(200, MP3));
  const q = createElevenLabsVoice(ctx(f.fetch));
  await q.synthesize({ turns: [turns[1]!], voices: tuned });
  await q.synthesize({ turns: [turns[0]!], voices: withModel });
  assert.equal(f.calls[0]?.url, 'https://api.elevenlabs.io/v1/text-to-speech/el-2?output_format=mp3_44100_128');
  assert.deepEqual(f.calls[0]?.json, { text: 'Hi, my brother.', model_id: 'eleven_v4', voice_settings: { stability: 0.3, speed: 1.1 }, seed: 1979 });
  assert.equal(f.calls[1]?.url, 'https://api.elevenlabs.io/v1/text-to-speech/el-1?output_format=mp3_44100_128');
  assert.equal((f.calls[1]?.json as { model_id: string }).model_id, 'eleven_multilingual_v2');
});

test('elevenlabs: retries 409 already_running and then returns the audio', async () => {
  const f = fakeFetch(reply(409, { detail: { status: 'already_running' } }), reply(200, MP3));
  const out = await createElevenLabsVoice(ctx(f.fetch)).synthesize({ turns, voices: VOICES_MAP });
  assert.equal(f.calls.length, 2);
  assert.equal(out.audio.length, MP3.length);
});

test('elevenlabs: an empty audio body is an error, not a silent gap', async () => {
  const f = fakeFetch(reply(200, new Uint8Array()));
  await assert.rejects(createElevenLabsVoice(ctx(f.fetch)).synthesize({ turns, voices: VOICES_MAP }), (e) => isDispatchError(e, 'bad-response'));
});

test('elevenlabs: preflight refuses an episode the account cannot cover', async () => {
  const f = fakeFetch(reply(200, { character_count: 9000, character_limit: 10000 }), reply(200, { character_count: 9000, character_limit: 10000 }));
  const p = createElevenLabsVoice(ctx(f.fetch));
  await p.preflight?.(900);
  await assert.rejects(p.preflight!(1001), (e) => isDispatchError(e, 'budget') && /1,001/.test(e.message) && /1,000/.test(e.message));
  assert.equal(f.calls[0]?.url, 'https://api.elevenlabs.io/v1/user/subscription');
  assert.equal(f.calls[0]?.method, 'GET');
});

test('elevenlabs: no key means no request', async () => {
  const f = forbiddenFetch();
  const p = createElevenLabsVoice({ env: {}, fetchImpl: f.fetch, sleep: instantSleep });
  await assert.rejects(p.synthesize({ turns, voices: VOICES_MAP }), (e) => isDispatchError(e, 'no-key'));
  assert.equal(f.state.called, 0);
});

test('elevenlabs: the cache key changes with the text, the voice and the model', () => {
  const p = createElevenLabsVoice(ctx(forbiddenFetch().fetch));
  const k = (v: unknown) => JSON.stringify(v);
  const base = k(p.requestKey({ turns, voices: VOICES_MAP }));
  assert.equal(k(p.requestKey({ turns, voices: VOICES_MAP })), base);
  assert.notEqual(k(p.requestKey({ turns: [turns[0]!], voices: VOICES_MAP })), base);
  assert.notEqual(k(p.requestKey({ turns, voices: { ...VOICES_MAP, S2: { id: 'other', name: 'Host 2' } } })), base);
  assert.notEqual(k(createElevenLabsVoice(ctx(forbiddenFetch().fetch, 'eleven_v3')).requestKey({ turns, voices: VOICES_MAP })), base);
});

test('openai: one speech request per turn with the voice and instructions', async () => {
  const f = fakeFetch(reply(200, MP3));
  const voices: VoiceMap = { S1: { id: 'onyx', name: 'Host 1', instructions: 'Fast and dry.' } };
  await createOpenAIVoice(ctx(f.fetch)).synthesize({ turns: [{ speaker: 'S1', text: 'Hello there.' }], voices });
  const [call] = f.calls;
  assert.equal(call?.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(call?.headers['authorization'], 'Bearer sk-oa');
  assert.deepEqual(call?.json, { model: 'gpt-4o-mini-tts', voice: 'onyx', input: 'Hello there.', response_format: 'mp3', instructions: 'Fast and dry.' });
});

test('openai: custom voice ids go as an object, and audio tags are not supported', async () => {
  const f = fakeFetch(reply(200, MP3));
  const p = createOpenAIVoice(ctx(f.fetch));
  await p.synthesize({ turns: [{ speaker: 'S1', text: 'Hi.' }], voices: { S1: { id: 'voice_123', name: 'n' } } });
  assert.deepEqual((f.calls[0]?.json as { voice: unknown }).voice, { id: 'voice_123' });
  assert.deepEqual(p.capabilities, { multiSpeaker: false, maxCharsPerRequest: 4096, maxVoicesPerRequest: 1, supportedTags: [], costPerChar: 0.000015 });
  await assert.rejects(p.synthesize({ turns, voices: VOICES_MAP }), (e) => isDispatchError(e, 'invalid-input'));
});

test('registry: resolves voice providers by name and lists them on a typo', () => {
  assert.deepEqual(Object.keys(VOICES).sort(), ['elevenlabs', 'openai']);
  assert.equal(getVoiceProvider('openai', ctx(forbiddenFetch().fetch)).name, 'openai');
  assert.throws(() => getVoiceProvider('eleven', ctx(forbiddenFetch().fetch)), (e) => isDispatchError(e, 'unknown-provider') && /elevenlabs, openai/.test(e.message));
});
