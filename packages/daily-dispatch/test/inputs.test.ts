import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseStories, prepareStories } from '../src/stories.ts';
import { parseVoiceMap, roleOf, placeholderVoices } from '../src/voices-file.ts';
import { isDispatchError } from '../src/errors.ts';

test('parseStories accepts a bare array and an edition object', () => {
  const one = { headline: 'H', source: 'S', summary: 'Sum', url: 'https://a.example' };
  assert.deepEqual(parseStories([one]), [one]);
  assert.deepEqual(parseStories({ date: 'x', stories: [one] }), [one]);
});

test('parseStories joins summary paragraphs and falls back to overview bullets', () => {
  const [a, b] = parseStories([
    { headline: 'A', source: 'S', summary: ['One.', 'Two.'], url: 'u1' },
    { headline: 'B', url: 'u2', summary: [], overview: [{ label: 'Why', text: 'Because.' }] },
  ]);
  assert.equal(a?.summary, 'One. Two.');
  assert.equal(b?.summary, 'Why: Because.');
  assert.equal(b?.source, 'Link');
});

test('parseStories rejects malformed input with the story index', () => {
  assert.throws(() => parseStories('nope'), (e) => isDispatchError(e, 'invalid-input'));
  assert.throws(
    () => parseStories([{ headline: 'ok', url: 'u' }, { headline: 3 }]),
    (e) => isDispatchError(e, 'invalid-input') && /story 2/.test(e.details.join()),
  );
  assert.throws(() => parseStories([]), (e) => isDispatchError(e, 'invalid-input'));
});

test('prepareStories drops repeated URLs and trims long summaries at a word', () => {
  const long = 'word '.repeat(200).trim();
  const out = prepareStories(
    [
      { headline: 'A', source: 's', summary: long, url: 'https://x.example/1' },
      { headline: 'A again', source: 's', summary: 'dup', url: 'https://x.example/1' },
      { headline: 'B', source: 's', summary: 'short', url: '' },
      { headline: 'C', source: 's', summary: 'short', url: '' },
    ],
    { maxSummary: 50 },
  );
  assert.deepEqual(out.map((s) => s.headline), ['A', 'B', 'C']);
  assert.ok((out[0]?.summary.length ?? 0) <= 50, 'summary trimmed');
  assert.match(out[0]?.summary ?? '', /word…$/);
});

test('parseVoiceMap validates tags, ids and names', () => {
  const ok = parseVoiceMap({ S1: { id: 'a', name: 'Host 1' }, CALLER_A: { id: 'b', name: 'Caller' } });
  assert.deepEqual(Object.keys(ok), ['S1', 'CALLER_A']);
  for (const bad of [[], { s1: { id: 'a', name: 'n' } }, { S1: { id: '', name: 'n' } }, { S1: { id: 'a' } }, {}]) {
    assert.throws(() => parseVoiceMap(bad), (e) => isDispatchError(e, 'invalid-input'), JSON.stringify(bad));
  }
  assert.throws(
    () => parseVoiceMap({ S1: { id: 'a', name: 'n', role: 'guest' } }),
    (e) => isDispatchError(e, 'invalid-input') && /role/.test(e.details.join()),
  );
});

test('roleOf defaults S<n> tags to hosts and everything else to callers', () => {
  assert.equal(roleOf('S1', { id: 'a', name: 'n' }), 'host');
  assert.equal(roleOf('CALLER_A', { id: 'a', name: 'n' }), 'caller');
  assert.equal(roleOf('GUEST', { id: 'a', name: 'n', role: 'host' }), 'host');
});

test('placeholderVoices lists tags still holding the example file ids', () => {
  const map = parseVoiceMap({ S1: { id: 'REPLACE_WITH_YOUR_ID', name: 'n' }, S2: { id: 'real', name: 'n' } });
  assert.deepEqual(placeholderVoices(map), ['S1']);
});

test('the shipped example files parse', async () => {
  const read = async (name: string): Promise<unknown> => JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
  assert.equal(parseStories(await read('stories.example.json')).length, 3);
  assert.equal(placeholderVoices(parseVoiceMap(await read('voices.elevenlabs.example.json'))).length, 4);
  assert.deepEqual(placeholderVoices(parseVoiceMap(await read('voices.openai.example.json'))), []);
});
