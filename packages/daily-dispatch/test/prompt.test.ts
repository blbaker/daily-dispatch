import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, cleanModelOutput } from '../src/script/prompt.ts';
import { textWriter } from '../src/writers/types.ts';
import { isDispatchError } from '../src/errors.ts';
import type { Prompt } from '../src/writers/types.ts';
import { REQ } from './helpers.ts';


test('the prompt carries the style guide, the facts rule, every story and the speakers', () => {
  const p = buildPrompt(REQ);
  assert.match(p.system, /real joke every 5 to 8 lines/);
  assert.match(p.system, /Every fact must come from the stories/);
  assert.match(p.system, /- S1: Host 1 \(host\)/);
  assert.match(p.system, /- CALLER_A: Pat, Duluth \(caller\)/);
  assert.match(p.system, /about 6,000 characters/);
  assert.match(p.system, /each turn on its own line/i);
  assert.match(p.system, /segment for the\s+opening/);
  // Small local models copy a literal "TAG:" placeholder; the example uses the real tags.
  assert.doesNotMatch(p.system, /\bTAG:/);
  assert.match(p.system, /\nS1: \[phone ringing\] Hello, you're on the show!\nCALLER_A: /);
  for (const s of REQ.stories) {
    assert.ok(p.user.includes(s.headline) && p.user.includes(s.url) && p.user.includes(s.summary), s.headline);
  }
  assert.match(p.user, /Sam, out in Springfield/);
  assert.match(p.system, /Every caller, whoever they are, speaks with one of these tags: CALLER_A\. Never invent a tag/);
  assert.ok(p.maxOutputTokens >= 6000 / 4, 'room for the whole script');
});

test('the prompt says so when there are no callers, and has a neutral listener fallback', () => {
  const p = buildPrompt({ ...REQ, voices: { S1: { id: 'a', name: 'A' }, S2: { id: 'b', name: 'B' } }, listener: {} });
  assert.match(p.system, /no callers today/i);
  assert.match(p.user, /a listener, out there somewhere/);
});

test('a custom style guide replaces the default but keeps the facts rule', () => {
  const p = buildPrompt({ ...REQ, styleGuide: 'Be terse.' });
  assert.match(p.system, /Be terse\./);
  assert.doesNotMatch(p.system, /real joke every 5 to 8 lines/);
  assert.match(p.system, /Every fact must come from the stories/);
});

test('cleanModelOutput drops fences, a chatty preamble and bold speaker tags', () => {
  const raw = 'Sure! Here is your script:\n```\n## Open\n**S1:** Hello.\n**S2**: Hi.\n```\nHope you like it.';
  assert.equal(cleanModelOutput(raw), '## Open\nS1: Hello.\nS2: Hi.\nHope you like it.');
});

test('cleanModelOutput drops a copied "Segment title:" label from headings', () => {
  assert.equal(cleanModelOutput('## Segment title: AI at work\nS1: Hi.'), '## AI at work\nS1: Hi.');
});

test('cleanModelOutput moves a stand-alone sound cue onto the next turn', () => {
  assert.equal(cleanModelOutput('## Call\n[phone ringing]\nS1: Hello, you are on.'), '## Call\nS1: [phone ringing] Hello, you are on.');
  assert.equal(cleanModelOutput('## End\nS1: Bye.\n[music]'), '## End\nS1: Bye.');
});

test('cleanModelOutput drops a turn that is only a laugh, keeping every spoken word', () => {
  assert.equal(cleanModelOutput('## Open\nS1: Joke.\nS2: [laughs]\nS2: Good one.'), '## Open\nS1: Joke.\nS2: Good one.');
});

test('textWriter parses the model output into a typed Script', async () => {
  const writer = textWriter({ name: 'fake', paid: false }, async () => '## Open\nS1: Hello.\nS2: Hi.');
  const script = await writer.write(REQ);
  assert.equal(script.title, 'Link Talk');
  assert.deepEqual(script.segments[0]?.turns, [{ speaker: 'S1', text: 'Hello.' }, { speaker: 'S2', text: 'Hi.' }]);
});

test('textWriter retries once with the parse problems, then succeeds', async () => {
  const prompts: Prompt[] = [];
  const outputs = ['## Open\nS9: Who?', '## Open\nS1: Better.'];
  const writer = textWriter({ name: 'fake', paid: false }, async (p) => {
    prompts.push(p);
    return outputs.shift() ?? '';
  });
  const script = await writer.write(REQ);
  assert.equal(script.segments[0]?.turns[0]?.text, 'Better.');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]?.user ?? '', /unknown speaker "S9"/);
  assert.match(prompts[1]?.user ?? '', /Your previous script:\n## Open\nS9: Who\?/);
});

test('textWriter gives up after the second bad script', async () => {
  let calls = 0;
  const writer = textWriter({ name: 'fake', paid: false }, async () => {
    calls += 1;
    return 'S1: [laughs]';
  });
  await assert.rejects(writer.write(REQ), (e) => isDispatchError(e, 'script-parse') && /fake/.test(e.message));
  assert.equal(calls, 2);
});
