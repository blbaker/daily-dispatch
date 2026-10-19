import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAzureVoice } from '../src/voices/azure.ts';
import { planChunks } from '../src/audio/chunk.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeFetch, forbiddenFetch, instantSleep, reply } from './helpers.ts';
import type { Env } from '../src/context.ts';
import type { VoiceMap } from '../src/types.ts';

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 5]);
const ENV = { AZURE_SPEECH_KEY: 'az-key', AZURE_SPEECH_REGION: 'eastus' };
const voices: VoiceMap = { S1: { id: 'en-US-AndrewMultilingualNeural', name: 'Host 1' }, S2: { id: 'en-US-AvaMultilingualNeural', name: 'Host 2' } };
const ctx = (fetchImpl: typeof fetch, env: Env = ENV) => ({ env, fetchImpl, sleep: instantSleep });

test('azure: one SSML request voices both hosts, with the documented headers', async () => {
  const f = fakeFetch(reply(200, MP3));
  const out = await createAzureVoice(ctx(f.fetch)).synthesize({
    turns: [
      { speaker: 'S1', text: 'Morning.' },
      { speaker: 'S2', text: 'Hi.' },
    ],
    voices,
  });
  const [call] = f.calls;
  assert.equal(call?.url, 'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(call?.method, 'POST');
  assert.equal(call?.headers['ocp-apim-subscription-key'], 'az-key');
  assert.equal(call?.headers['content-type'], 'application/ssml+xml');
  assert.equal(call?.headers['x-microsoft-outputformat'], 'audio-24khz-96kbitrate-mono-mp3');
  assert.equal(call?.headers['user-agent'], 'daily-dispatch');
  assert.equal(
    call?.body,
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
      "<voice name='en-US-AndrewMultilingualNeural'>Morning.</voice>" +
      "<voice name='en-US-AvaMultilingualNeural'>Hi.</voice></speak>",
  );
  assert.deepEqual([...out.audio], [...MP3]);
});

test('azure: text and voice names are XML-escaped, so a script cannot break the SSML', async () => {
  const f = fakeFetch(reply(200, MP3));
  const odd: VoiceMap = { S1: { id: "de-DE-Katja'Neural", name: 'Host 1' } };
  await createAzureVoice(ctx(f.fetch)).synthesize({ turns: [{ speaker: 'S1', text: 'AT&T <b>"5 > 3"</b>' }], voices: odd });
  assert.equal(
    f.calls[0]?.body,
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='de-DE'>" +
      "<voice name='de-DE-Katja&apos;Neural'>AT&amp;T &lt;b&gt;&quot;5 &gt; 3&quot;&lt;/b&gt;</voice></speak>",
  );
});

test('azure: at most 50 voice elements per request, so the chunker caps turns', () => {
  const p = createAzureVoice(ctx(forbiddenFetch().fetch));
  assert.equal(p.capabilities.maxTurnsPerRequest, 50);
  assert.equal(p.capabilities.multiSpeaker, true);
  const turns = Array.from({ length: 120 }, (_, i) => ({ speaker: i % 2 === 0 ? 'S1' : 'S2', text: 'Yes.' }));
  const chunks = planChunks({ title: 'T', segments: [{ title: 'Open', turns }] }, p.capabilities);
  assert.deepEqual(chunks.map((c) => c.turns.length), [50, 50, 20]);
});

test('azure: region is required and validated before anything is sent', async () => {
  const f = forbiddenFetch();
  const none = createAzureVoice(ctx(f.fetch, { AZURE_SPEECH_KEY: 'k' }));
  assert.throws(() => none.checkConfig?.(), (e) => isDispatchError(e, 'no-key') && /AZURE_SPEECH_REGION/.test(e.message));
  const bad = createAzureVoice(ctx(f.fetch, { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'evil.example/x' }));
  assert.throws(() => bad.checkConfig?.(), (e) => isDispatchError(e, 'usage'));
  await assert.rejects(none.synthesize({ turns: [{ speaker: 'S1', text: 'x' }], voices }), (e) => isDispatchError(e, 'no-key'));
  await assert.rejects(createAzureVoice(ctx(f.fetch, {})).synthesize({ turns: [{ speaker: 'S1', text: 'x' }], voices }), (e) => isDispatchError(e, 'no-key') && /AZURE_SPEECH_KEY/.test(e.message));
  assert.equal(f.state.called, 0);
});

test('azure: paid at the neural list price, tags stripped', () => {
  const p = createAzureVoice(ctx(forbiddenFetch().fetch));
  assert.equal(p.paid, true);
  assert.equal(p.keyEnv, 'AZURE_SPEECH_KEY');
  assert.equal(p.capabilities.costPerChar, 0.000015);
  assert.deepEqual(p.capabilities.supportedTags, []);
});
