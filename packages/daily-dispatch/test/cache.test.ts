import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chunkHash, synthesizeChunks } from '../src/audio/cache.ts';
import { DispatchError, isDispatchError } from '../src/errors.ts';
import type { Chunk } from '../src/audio/chunk.ts';
import type { VoiceProvider, SynthesisRequest } from '../src/voices/types.ts';

const voices = { S1: { id: 'a', name: 'A' }, S2: { id: 'b', name: 'B' } };
const chunk = (index: number, text: string): Chunk => ({ index, segment: 0, turns: [{ speaker: 'S1', text }], chars: text.length, lastInSegment: false });

function fakeVoice(opts: { failOn?: string; delayMs?: number } = {}) {
  const calls: SynthesisRequest[] = [];
  const state = { inFlight: 0, maxInFlight: 0 };
  const provider: VoiceProvider = {
    name: 'fake',
    paid: false,
    capabilities: { multiSpeaker: true, maxCharsPerRequest: 100, maxVoicesPerRequest: 10, supportedTags: 'all', costPerChar: 0 },
    costSource: 'test',
    requestKey: (req) => req.turns,
    async synthesize(req) {
      calls.push(req);
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 1));
      state.inFlight -= 1;
      if (req.turns[0]?.text === opts.failOn) throw new DispatchError('http', 'boom');
      return { audio: new TextEncoder().encode(`audio:${req.turns[0]?.text}`), billedChars: 7 };
    },
  };
  return { provider, calls, state };
}

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'dd-cache-'));

test('chunkHash is stable across key order and differs by provider', () => {
  assert.equal(chunkHash('p', { a: 1, b: [1, 2] }), chunkHash('p', { b: [1, 2], a: 1 }));
  assert.notEqual(chunkHash('p', { a: 1 }), chunkHash('q', { a: 1 }));
  assert.match(chunkHash('p', 'x'), /^[0-9a-f]{16}$/);
});

test('voices every chunk once, then serves a rerun entirely from the cache', async () => {
  const dir = await tmp();
  const chunks = [chunk(0, 'one'), chunk(1, 'two'), chunk(2, 'three')];
  const first = fakeVoice();
  const out = await synthesizeChunks(chunks, first.provider, voices, dir);
  assert.equal(first.calls.length, 3);
  assert.deepEqual(out.map((o) => o.status), ['new', 'new', 'new']);
  assert.equal(await fs.readFile(out[1]!.path, 'utf8'), 'audio:two');
  assert.ok(path.isAbsolute(out[0]!.path));

  const again = fakeVoice();
  const cached = await synthesizeChunks(chunks, again.provider, voices, dir);
  assert.equal(again.calls.length, 0);
  assert.deepEqual(cached.map((o) => o.status), ['cached', 'cached', 'cached']);
});

test('after an edit only the changed chunk is voiced again, even if chunks shift', async () => {
  const dir = await tmp();
  await synthesizeChunks([chunk(0, 'one'), chunk(1, 'two')], fakeVoice().provider, voices, dir);
  const v = fakeVoice();
  const out = await synthesizeChunks([chunk(0, 'zero'), chunk(1, 'one'), chunk(2, 'two')], v.provider, voices, dir);
  assert.deepEqual(v.calls.map((c) => c.turns[0]?.text), ['zero']);
  assert.deepEqual(out.map((o) => o.status), ['new', 'cached', 'cached']);
});

test('runs at most three requests at a time by default', async () => {
  const v = fakeVoice({ delayMs: 5 });
  await synthesizeChunks(Array.from({ length: 8 }, (_, i) => chunk(i, `t${i}`)), v.provider, voices, await tmp());
  assert.equal(v.state.maxInFlight, 3);
});

test('a failed chunk rejects the run and leaves no audio file behind for it', async () => {
  const dir = await tmp();
  const v = fakeVoice({ failOn: 'bad' });
  await assert.rejects(synthesizeChunks([chunk(0, 'good'), chunk(1, 'bad')], v.provider, voices, dir), (e) => isDispatchError(e, 'http'));
  const files = await fs.readdir(dir);
  assert.equal(files.filter((f) => f.endsWith('.mp3')).length, 1, `only the good chunk is cached: ${files.join(',')}`);
  assert.equal(files.filter((f) => f.includes('.tmp')).length, 0);
});
