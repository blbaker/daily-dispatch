import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleVoice } from '../src/voices/google.ts';
import { effectiveCapabilities } from '../src/voices/types.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeFetch, forbiddenFetch, instantSleep, reply } from './helpers.ts';
import type { VoiceMap } from '../src/types.ts';

const WAV = Buffer.from('RIFF....WAVEfmt fake-pcm');
const ok = (data = WAV) => reply(200, { id: 'i1', steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: data.toString('base64') }] }] });
const voices: VoiceMap = { S1: { id: 'Kore', name: 'Host 1', instructions: 'dry and quick' }, S2: { id: 'Puck', name: 'Host 2' }, CALLER_A: { id: 'Charon', name: 'Pat' } };
const ctx = (fetchImpl: typeof fetch, env: Record<string, string> = { GEMINI_API_KEY: 'g-key' }) => ({ env, fetchImpl, sleep: instantSleep });
const turns = [
  { speaker: 'S1', text: 'Big news today.' },
  { speaker: 'S2', text: 'Tell me.' },
];

test('google: two hosts go in one Interactions request with one speaker entry each', async () => {
  const f = fakeFetch(ok());
  const out = await createGoogleVoice(ctx(f.fetch)).synthesize({ turns, voices });
  const [call] = f.calls;
  assert.equal(call?.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(call?.method, 'POST');
  assert.equal(call?.headers['x-goog-api-key'], 'g-key');
  assert.deepEqual(call?.json, {
    model: 'gemini-3.8-flash-tts',
    input: [
      {
        type: 'user_input',
        content: [
          { type: 'text', text: 'Big news today.', annotations: [{ type: 'speech_metadata', speaker: 'S1', style: 'dry and quick' }] },
          { type: 'text', text: 'Tell me.', annotations: [{ type: 'speech_metadata', speaker: 'S2' }] },
        ],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: { speakers: [{ speaker: 'S1', voice: 'Kore' }, { speaker: 'S2', voice: 'Puck' }] } },
  });
  assert.deepEqual(Buffer.from(out.audio), WAV, 'the base64 audio is decoded, WAV header and all');
});

test('google: a chunk with one speaker uses the single-voice form', async () => {
  const f = fakeFetch(ok());
  await createGoogleVoice(ctx(f.fetch)).synthesize({ turns: [{ speaker: 'S2', text: 'Solo.' }, { speaker: 'S2', text: 'Still me.' }], voices });
  const json = f.calls[0]?.json as { generation_config: unknown; input: Array<{ content: unknown[] }> };
  assert.deepEqual(json.generation_config, { speech_config: [{ voice: 'Puck' }] });
  assert.deepEqual(json.input[0]?.content[0], { type: 'text', text: 'Solo.', annotations: [{ type: 'speech_metadata' }] });
});

test('google: at most two prebuilt voices per request; custom voices go one turn at a time', () => {
  const p = createGoogleVoice(ctx(forbiddenFetch().fetch));
  assert.equal(effectiveCapabilities(p, voices).multiSpeaker, true);
  assert.equal(effectiveCapabilities(p, voices).maxVoicesPerRequest, 2);
  const custom: VoiceMap = { ...voices, S2: { id: 'voice_abc123', name: 'Host 2' } };
  assert.equal(effectiveCapabilities(p, custom).multiSpeaker, false);
  assert.equal(effectiveCapabilities(p, custom).maxVoicesPerRequest, 1);
});

test('google: three speakers in one request is refused before sending', async () => {
  const f = forbiddenFetch();
  const three = [...turns, { speaker: 'CALLER_A', text: 'Hi.' }];
  await assert.rejects(createGoogleVoice(ctx(f.fetch)).synthesize({ turns: three, voices }), (e) => isDispatchError(e, 'invalid-input'));
  assert.equal(f.state.called, 0);
});

test('google: a reply without audio is a bad response, not an empty chunk', async () => {
  const f = fakeFetch(reply(200, { steps: [{ type: 'model_output', content: [{ type: 'text', text: 'blocked' }] }] }));
  await assert.rejects(createGoogleVoice(ctx(f.fetch)).synthesize({ turns, voices }), (e) => isDispatchError(e, 'bad-response'));
});

test('google: no key means no request, and the model can be overridden', async () => {
  const f = forbiddenFetch();
  await assert.rejects(createGoogleVoice(ctx(f.fetch, {})).synthesize({ turns, voices }), (e) => isDispatchError(e, 'no-key') && /GEMINI_API_KEY/.test(e.message));
  assert.equal(f.state.called, 0);
  const g = fakeFetch(ok());
  await createGoogleVoice({ ...ctx(g.fetch), model: 'gemini-3.8-flash-lite-tts' }).synthesize({ turns, voices });
  assert.equal((g.calls[0]?.json as { model: string }).model, 'gemini-3.8-flash-lite-tts');
});

test('google: paid, with a cost per character derived from the audio token price', () => {
  const p = createGoogleVoice(ctx(forbiddenFetch().fetch));
  assert.equal(p.paid, true);
  assert.equal(p.keyEnv, 'GEMINI_API_KEY');
  assert.ok(p.capabilities.costPerChar > 0.00001 && p.capabilities.costPerChar < 0.00002);
  assert.match(p.costSource, /ai\.google\.dev/);
});
