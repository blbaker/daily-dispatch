import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChunks, filterTags } from '../src/audio/chunk.ts';
import { renderTranscript } from '../src/audio/transcript.ts';
import { isDispatchError } from '../src/errors.ts';
import type { VoiceCapabilities } from '../src/voices/types.ts';
import type { Script, Turn } from '../src/types.ts';

const caps = (over: Partial<VoiceCapabilities> = {}): VoiceCapabilities => ({
  multiSpeaker: true,
  maxCharsPerRequest: 80,
  maxVoicesPerRequest: 10,
  supportedTags: 'all',
  costPerChar: 0,
  ...over,
});
const t = (speaker: string, n: number, ch = 'a'): Turn => ({ speaker, text: ch.repeat(n) });
const one = (...turns: Turn[]): Script => ({ title: 'T', segments: [{ title: 'Open', turns }] });

test('splits on turn boundaries once the next turn would pass maxChars', () => {
  const chunks = planChunks(one(t('S1', 50), t('S2', 60)), caps());
  assert.deepEqual(chunks.map((c) => c.chars), [50, 60]);
  assert.deepEqual(chunks.map((c) => c.lastInSegment), [false, true]);
});

test('a chunk may fill maxChars exactly but not pass it', () => {
  assert.equal(planChunks(one(t('S1', 40), t('S2', 40)), caps()).length, 1);
  assert.equal(planChunks(one(t('S1', 40), t('S2', 41)), caps()).length, 2);
});

test('the production 1,900-character limit packs 19 hundred-character turns per chunk', () => {
  const turns = Array.from({ length: 30 }, (_, i) => t(i % 2 ? 'S2' : 'S1', 100));
  const chunks = planChunks(one(...turns), caps({ maxCharsPerRequest: 1900 }));
  assert.deepEqual(chunks.map((c) => c.turns.length), [19, 11]);
  assert.deepEqual(chunks.map((c) => c.index), [0, 1]);
});

test('never puts two segments in one chunk', () => {
  const script: Script = {
    title: 'T',
    segments: [
      { title: 'A', turns: [t('S1', 5)] },
      { title: 'B', turns: [t('S1', 5)] },
    ],
  };
  const chunks = planChunks(script, caps());
  assert.deepEqual(chunks.map((c) => [c.segment, c.lastInSegment]), [[0, true], [1, true]]);
});

test('single-speaker providers get one turn per request', () => {
  const chunks = planChunks(one(t('S1', 5), t('S2', 5), t('S1', 5)), caps({ multiSpeaker: false, maxVoicesPerRequest: 1 }));
  assert.deepEqual(chunks.map((c) => c.turns.length), [1, 1, 1]);
  // Same speaker twice in a row: only the one-turn rule can split these, not the voice limit.
  const same = planChunks(one(t('S1', 5), t('S1', 5)), caps({ multiSpeaker: false, maxVoicesPerRequest: 10 }));
  assert.deepEqual(same.map((c) => c.turns.length), [1, 1]);
});

test('starts a new chunk when a request would exceed the unique-voice limit', () => {
  const chunks = planChunks(one(t('S1', 5), t('S2', 5), t('S1', 5), t('CALLER_A', 5)), caps({ maxVoicesPerRequest: 2 }));
  assert.deepEqual(chunks.map((c) => c.turns.map((x) => x.speaker)), [['S1', 'S2', 'S1'], ['CALLER_A']]);
});

test('a single turn longer than the request limit is an error, not a silent overrun', () => {
  assert.throws(
    () => planChunks(one(t('S1', 81)), caps()),
    (e) => isDispatchError(e, 'turn-too-long') && /81/.test(e.message),
  );
});

test('filterTags keeps only the tags a provider supports', () => {
  assert.equal(filterTags('[laughs] Hi [sighs] there', 'all'), '[laughs] Hi [sighs] there');
  assert.equal(filterTags('[laughs] Hi [sighs] there', []), 'Hi there');
  assert.equal(filterTags('[Laughs] Hi [sighs] there', ['laughs']), '[Laughs] Hi there');
});

test('chunk text and character counts are measured after tag filtering', () => {
  const [chunk] = planChunks(one({ speaker: 'S1', text: '[laughs] Hello' }), caps({ supportedTags: [] }));
  assert.equal(chunk?.turns[0]?.text, 'Hello');
  assert.equal(chunk?.chars, 5);
});

test('transcript names speakers and drops audio tags', () => {
  const md = renderTranscript(
    { title: 'Test Show', segments: [{ title: 'Open', turns: [{ speaker: 'S1', text: '[laughing] Hello there.' }] }] },
    { S1: { id: 'x', name: 'Host One' } },
  );
  assert.equal(md, '# Test Show\n\n## Open\n\n**Host One:** Hello there.  \n');
});
