import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, formatScript, stripTags } from '../src/script/parse.ts';
import { isDispatchError } from '../src/errors.ts';

const SPEAKERS = ['S1', 'S2', 'CALLER_A'];

function parseError(text: string): readonly string[] {
  try {
    parseScript(text, SPEAKERS);
  } catch (e) {
    assert.ok(isDispatchError(e, 'script-parse'), `expected script-parse, got ${String(e)}`);
    return e.details;
  }
  assert.fail('expected parseScript to throw');
}

test('parses segments and turns in order', () => {
  const script = parseScript('## Open\nS1: Hello there.\nS2: [laughing] My brother again.\n\n## Calls\nCALLER_A: Hi!', SPEAKERS);
  assert.deepEqual(script.segments, [
    { title: 'Open', turns: [{ speaker: 'S1', text: 'Hello there.' }, { speaker: 'S2', text: '[laughing] My brother again.' }] },
    { title: 'Calls', turns: [{ speaker: 'CALLER_A', text: 'Hi!' }] },
  ]);
});

test('a turn before any heading lands in an Intro segment', () => {
  const script = parseScript('S1: No heading yet.', SPEAKERS);
  assert.equal(script.segments[0]?.title, 'Intro');
});

test('rejects a turn that is only audio tags', () => {
  const details = parseError('## Open\nS1: Words here.\nS2: [laughs]');
  assert.equal(details.length, 1);
  assert.match(details[0] ?? '', /line 3: tag-only turn/);
});

test('rejects a speaker that is not in the voice map', () => {
  const details = parseError('## Open\nS9: Who is this?');
  assert.match(details[0] ?? '', /line 2: unknown speaker "S9"/);
});

test('rejects a line that is neither a heading nor a turn', () => {
  const details = parseError('## Open\nHere is the rest of the show');
  assert.match(details[0] ?? '', /line 2: not a "## heading" or "TAG: text" line/);
});

test('rejects a turn that contains a second speaker tag (two speakers on one line)', () => {
  const details = parseError("## Open\nS1: [phone ringing] Hello, you're on the show! CALLER_A: Hi, I'm Pat.");
  assert.match(details[0] ?? '', /line 2: two speakers on one line \(found "CALLER_A:"\)/);
});

test('a colon after an ordinary word is still fine', () => {
  const script = parseScript('S1: Here is the thing: it works. Also S3: not a speaker here.', SPEAKERS);
  assert.equal(script.segments[0]?.turns.length, 1);
});

test('reports every problem, not just the first', () => {
  const details = parseError('## Open\nS9: a\nS1: [sighs]\nnonsense');
  assert.equal(details.length, 3);
});

test('rejects a script with no turns', () => {
  const details = parseError('## Open\n\n## Close');
  assert.match(details[0] ?? '', /no turns/);
});

test('rejects an empty segment title', () => {
  const details = parseError('##   \nS1: hi');
  assert.match(details[0] ?? '', /line 1: empty segment title/);
});

test('formatScript round-trips through parseScript', () => {
  const text = '## Open\nS1: Hello.\nS2: [laughs] Hi.\n\n## Close\nS1: Bye.\n';
  assert.equal(formatScript(parseScript(text, SPEAKERS)), text);
});

test('stripTags removes bracketed audio tags and tidies spaces', () => {
  assert.equal(stripTags('[laughing] Well, [sighs] hello there.'), 'Well, hello there.');
  assert.equal(stripTags('[laughs] [phone ringing]'), '');
});
