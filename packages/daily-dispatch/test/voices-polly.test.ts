import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signV4 } from '../src/voices/sigv4.ts';
import { createPollyVoice } from '../src/voices/polly.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeFetch, forbiddenFetch, instantSleep, reply } from './helpers.ts';
import type { Env } from '../src/context.ts';

// AWS's published example credentials, not a real key.
const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const ENV = { AWS_ACCESS_KEY_ID: CREDS.accessKeyId, AWS_SECRET_ACCESS_KEY: CREDS.secretAccessKey, AWS_REGION: 'us-west-2' };
const NOW = new Date('2026-10-19T14:05:00Z');
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 7]);
const voices = { S1: { id: 'Matthew', name: 'Host 1' }, S2: { id: 'Ruth', name: 'Host 2' } };
const ctx = (fetchImpl: typeof fetch, env: Env = ENV, model?: string) => ({ env, fetchImpl, sleep: instantSleep, now: () => NOW, ...(model ? { model } : {}) });
const hello = { turns: [{ speaker: 'S1', text: 'Hello there.' }], voices };

test('sigv4: matches the get-vanilla case from the AWS Signature V4 test suite', () => {
  const h = signV4({ method: 'GET', url: 'https://example.amazonaws.com/', headers: {}, body: '' }, CREDS, { region: 'us-east-1', service: 'service', now: new Date('2015-08-30T12:36:00Z') });
  assert.equal(h['x-amz-date'], '20150830T123600Z');
  assert.equal(
    h['authorization'],
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
  );
});

test('polly: a signed SynthesizeSpeech request, byte-identical to what the AWS SDK signs', async () => {
  const f = fakeFetch(reply(200, MP3, { 'x-amzn-requestcharacters': '12' }));
  const out = await createPollyVoice(ctx(f.fetch)).synthesize(hello);
  const [call] = f.calls;
  assert.equal(call?.url, 'https://polly.us-west-2.amazonaws.com/v1/speech');
  assert.equal(call?.method, 'POST');
  assert.equal(call?.body, '{"Engine":"neural","OutputFormat":"mp3","Text":"Hello there.","TextType":"text","VoiceId":"Matthew"}');
  assert.equal(call?.headers['content-type'], 'application/json');
  assert.equal(call?.headers['x-amz-date'], '20261019T140500Z');
  // Signature computed independently with @smithy/signature-v4 for the same request.
  assert.equal(
    call?.headers['authorization'],
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261019/us-west-2/polly/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=fa43dc2ff38783df2fc98690ba398dc5652c3638764310030c0707288b2f71dd',
  );
  assert.deepEqual([...out.audio], [...MP3]);
  assert.equal(out.billedChars, 12);
});

test('polly: temporary credentials send and sign the session token', async () => {
  const f = fakeFetch(reply(200, MP3));
  await createPollyVoice(ctx(f.fetch, { ...ENV, AWS_SESSION_TOKEN: 'TOKEN123' })).synthesize(hello);
  assert.equal(f.calls[0]?.headers['x-amz-security-token'], 'TOKEN123');
  assert.match(f.calls[0]?.headers['authorization'] ?? '', /SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=94fd0b0b95b3668bddd7c606587fe3965c8b480466e4c0118947c016960209d7$/);
});

test('polly: the engine sets both the request and the price', async () => {
  const f = fakeFetch(reply(200, MP3));
  const gen = createPollyVoice(ctx(f.fetch, ENV, 'generative'));
  await gen.synthesize(hello);
  assert.equal((f.calls[0]?.json as { Engine: string }).Engine, 'generative');
  assert.equal(gen.capabilities.costPerChar, 0.00003);
  assert.equal(createPollyVoice(ctx(forbiddenFetch().fetch)).capabilities.costPerChar, 0.000016);
  assert.equal(createPollyVoice(ctx(forbiddenFetch().fetch, ENV, 'standard')).capabilities.costPerChar, 0.000004);
  assert.throws(() => createPollyVoice(ctx(forbiddenFetch().fetch, ENV, 'turbo')), (e) => isDispatchError(e, 'usage') && /neural/.test(e.message));
});

test('polly: one voice per request, 3,000 billed characters, tags stripped', () => {
  const p = createPollyVoice(ctx(forbiddenFetch().fetch));
  assert.equal(p.paid, true);
  assert.equal(p.keyEnv, 'AWS_ACCESS_KEY_ID');
  assert.deepEqual({ ...p.capabilities, costPerChar: 0 }, { multiSpeaker: false, maxCharsPerRequest: 3000, maxVoicesPerRequest: 1, supportedTags: [], costPerChar: 0 });
});

test('polly: a missing secret or region is caught by checkConfig, before any request', async () => {
  const f = forbiddenFetch();
  const noSecret = createPollyVoice(ctx(f.fetch, { AWS_ACCESS_KEY_ID: 'a', AWS_REGION: 'us-east-1' }));
  assert.throws(() => noSecret.checkConfig?.(), (e) => isDispatchError(e, 'no-key') && /AWS_SECRET_ACCESS_KEY/.test(e.message));
  const noRegion = createPollyVoice(ctx(f.fetch, { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' }));
  assert.throws(() => noRegion.checkConfig?.(), (e) => isDispatchError(e, 'no-key') && /AWS_REGION/.test(e.message));
  await assert.rejects(noRegion.synthesize(hello), (e) => isDispatchError(e, 'no-key'));
  const fallback = createPollyVoice(ctx(f.fetch, { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_DEFAULT_REGION: 'eu-west-1' }));
  fallback.checkConfig?.();
  const odd = createPollyVoice(ctx(f.fetch, { ...ENV, AWS_REGION: 'evil.example/x' }));
  assert.throws(() => odd.checkConfig?.(), (e) => isDispatchError(e, 'usage'));
  assert.equal(f.state.called, 0);
});
