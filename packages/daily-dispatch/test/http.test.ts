import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendJson, requireKey } from '../src/http.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeFetch, reply } from './helpers.ts';

function harness(...replies: Array<Response | Error>) {
  const sleeps: number[] = [];
  const f = fakeFetch(...replies);
  const opts = { fetchImpl: f.fetch, sleep: async (ms: number) => void sleeps.push(ms), provider: 'acme', keyEnv: 'ACME_KEY' };
  return { f, sleeps, opts };
}

test('sends a JSON body with a JSON content type', async () => {
  const { f, opts } = harness(reply(200, { ok: true }));
  await sendJson('https://api.acme.test/v1/x', { headers: { 'x-key': 'k' }, body: { a: 1 } }, opts);
  const [call] = f.calls;
  assert.equal(call?.url, 'https://api.acme.test/v1/x');
  assert.equal(call?.method, 'POST');
  assert.equal(call?.headers['content-type'], 'application/json');
  assert.equal(call?.headers['x-key'], 'k');
  assert.deepEqual(call?.json, { a: 1 });
});

test('retries 409 already_running with backoff, then returns the success', async () => {
  const { f, sleeps, opts } = harness(reply(409, 'already_running'), reply(200, 'ok'));
  const res = await sendJson('https://api.acme.test/x', { body: {} }, opts);
  assert.equal(res.status, 200);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(sleeps, [5000]);
});

test('gives up on a 503 after three retries and reports the status', async () => {
  const { f, sleeps, opts } = harness(reply(503, 'busy'), reply(503, 'busy'), reply(503, 'busy'), reply(503, 'busy'));
  await assert.rejects(sendJson('https://api.acme.test/x', { body: {} }, opts), (e) => isDispatchError(e, 'http') && /503/.test(e.message));
  assert.equal(f.calls.length, 4);
  assert.deepEqual(sleeps, [5000, 10000, 20000]);
});

test('401 is "unauthorized" and names the env var, without retrying', async () => {
  const { f, opts } = harness(reply(401, 'bad key'));
  await assert.rejects(
    sendJson('https://api.acme.test/x', { body: {} }, opts),
    (e) => isDispatchError(e, 'unauthorized') && /ACME_KEY/.test(e.message),
  );
  assert.equal(f.calls.length, 1);
});

test('a 429 that outlasts the retries is "rate-limited"', async () => {
  const { opts } = harness(reply(429, ''), reply(429, ''), reply(429, ''), reply(429, ''));
  await assert.rejects(sendJson('https://api.acme.test/x', { body: {} }, opts), (e) => isDispatchError(e, 'rate-limited'));
});

test('a 400 is not retried and carries the start of the body', async () => {
  const { f, opts } = harness(reply(400, { detail: 'input_text_empty' }));
  await assert.rejects(sendJson('https://api.acme.test/x', { body: {} }, opts), (e) => isDispatchError(e, 'http') && /input_text_empty/.test(e.message));
  assert.equal(f.calls.length, 1);
});

test('a transport failure becomes "network" after the retries', async () => {
  const boom = new TypeError('fetch failed');
  const { f, opts } = harness(boom, boom, boom, boom);
  await assert.rejects(sendJson('https://api.acme.test/x', { method: 'GET' }, opts), (e) => isDispatchError(e, 'network') && /api\.acme\.test/.test(e.message));
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[0]?.method, 'GET');
});

test('requireKey returns the trimmed key or a "no-key" error naming the variable', () => {
  assert.equal(requireKey({ ACME_KEY: ' k \n' }, 'ACME_KEY', 'acme'), 'k');
  assert.throws(() => requireKey({}, 'ACME_KEY', 'acme'), (e) => isDispatchError(e, 'no-key') && /ACME_KEY/.test(e.message));
  assert.throws(() => requireKey({ ACME_KEY: '  ' }, 'ACME_KEY', 'acme'), (e) => isDispatchError(e, 'no-key'));
});

test('sends a raw body as-is with the caller\'s content type', async () => {
  const { f, opts } = harness(reply(200, 'ok'));
  await sendJson('https://api.acme.test/x', { headers: { 'content-type': 'application/ssml+xml' }, raw: '<speak/>' }, opts);
  const [call] = f.calls;
  assert.equal(call?.method, 'POST');
  assert.equal(call?.body, '<speak/>');
  assert.equal(call?.headers['content-type'], 'application/ssml+xml');
});
