import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicWriter } from '../src/writers/anthropic.ts';
import { createOpenAIWriter } from '../src/writers/openai.ts';
import { createOllamaWriter } from '../src/writers/ollama.ts';
import { createCommandWriter, splitCommand } from '../src/writers/command.ts';
import { getWriter, WRITERS } from '../src/writers/registry.ts';
import { isDispatchError } from '../src/errors.ts';
import { REQ, fakeFetch, fakeSpawn, forbiddenFetch, instantSleep, reply } from './helpers.ts';
import type { ProviderContext } from '../src/context.ts';

const SCRIPT = '## Open\nS1: Hello there.\nS2: Hi, my brother.';
const ctx = (fetchImpl: typeof fetch, env: Record<string, string> = {}, extra: Partial<ProviderContext> = {}): ProviderContext => ({
  env,
  fetchImpl,
  sleep: instantSleep,
  ...extra,
});

test('anthropic: Messages API request shape and reply parsing', async () => {
  const f = fakeFetch(reply(200, { content: [{ type: 'text', text: SCRIPT }], stop_reason: 'end_turn' }));
  const script = await createAnthropicWriter(ctx(f.fetch, { ANTHROPIC_API_KEY: 'sk-ant' })).write(REQ);
  const [call] = f.calls;
  assert.equal(call?.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call?.headers['x-api-key'], 'sk-ant');
  assert.equal(call?.headers['anthropic-version'], '2023-06-01');
  const body = call?.json as { model: string; max_tokens: number; system: string; messages: Array<{ role: string; content: string }> };
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.ok(body.max_tokens > 1000);
  assert.match(body.system, /Every fact must come from the stories/);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0]?.role, 'user');
  assert.match(body.messages[0]?.content ?? '', /Tiny router beats big one/);
  assert.equal(script.segments[0]?.turns.length, 2);
});

test('anthropic: a reply cut off at max_tokens is an error, and --model is honoured', async () => {
  const f = fakeFetch(reply(200, { content: [{ type: 'text', text: SCRIPT }], stop_reason: 'max_tokens' }));
  const writer = createAnthropicWriter(ctx(f.fetch, { ANTHROPIC_API_KEY: 'k' }, { model: 'claude-haiku-5-5' }));
  await assert.rejects(writer.write(REQ), (e) => isDispatchError(e, 'bad-response') && /cut off/.test(e.message));
  assert.equal((f.calls[0]?.json as { model: string }).model, 'claude-haiku-5-5');
});

test('anthropic: no key means no request', async () => {
  const f = forbiddenFetch();
  await assert.rejects(createAnthropicWriter(ctx(f.fetch)).write(REQ), (e) => isDispatchError(e, 'no-key'));
  assert.equal(f.state.called, 0);
});

test('openai: Chat Completions request shape and reply parsing', async () => {
  const f = fakeFetch(reply(200, { choices: [{ message: { role: 'assistant', content: SCRIPT }, finish_reason: 'stop' }] }));
  const script = await createOpenAIWriter(ctx(f.fetch, { OPENAI_API_KEY: 'sk-oa' })).write(REQ);
  const [call] = f.calls;
  assert.equal(call?.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(call?.headers['authorization'], 'Bearer sk-oa');
  const body = call?.json as { model: string; max_completion_tokens: number; messages: Array<{ role: string; content: string }> };
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.ok(body.max_completion_tokens > 1000);
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.match(body.messages[0]?.content ?? '', /Puzzler/);
  assert.equal(script.segments[0]?.turns[1]?.speaker, 'S2');
});

test('openai: finish_reason "length" is an error', async () => {
  const f = fakeFetch(reply(200, { choices: [{ message: { content: SCRIPT }, finish_reason: 'length' }] }));
  await assert.rejects(createOpenAIWriter(ctx(f.fetch, { OPENAI_API_KEY: 'k' })).write(REQ), (e) => isDispatchError(e, 'bad-response'));
});

test('ollama: /api/chat request shape with a context window sized to the prompt', async () => {
  const f = fakeFetch(reply(200, { message: { role: 'assistant', content: SCRIPT }, done: true, done_reason: 'stop' }));
  await createOllamaWriter(ctx(f.fetch)).write(REQ);
  const [call] = f.calls;
  assert.equal(call?.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(call?.headers['authorization'], undefined);
  const body = call?.json as { model: string; stream: boolean; options: { num_ctx: number }; messages: Array<{ role: string; content: string }> };
  assert.equal(body.model, 'llama3.1:8b');
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  const promptTokens = (body.messages[0]!.content.length + body.messages[1]!.content.length) / 4;
  assert.ok(body.options.num_ctx >= promptTokens + 2000, `num_ctx ${body.options.num_ctx} leaves room for the reply`);
  assert.ok(body.options.num_ctx >= 8192, 'never below the 8k floor');
});

test('ollama: OLLAMA_HOST without a scheme and OLLAMA_MODEL are honoured', async () => {
  const f = fakeFetch(reply(200, { message: { content: SCRIPT }, done: true }));
  await createOllamaWriter(ctx(f.fetch, { OLLAMA_HOST: '10.0.0.5:11434', OLLAMA_MODEL: 'qwen3:14b' })).write(REQ);
  assert.equal(f.calls[0]?.url, 'http://10.0.0.5:11434/api/chat');
  assert.equal((f.calls[0]?.json as { model: string }).model, 'qwen3:14b');
});

test('ollama: a free local writer gets three attempts at the format', async () => {
  const bad = { message: { content: '## Open\nS9: nope' }, done: true };
  const f = fakeFetch(reply(200, bad), reply(200, bad), reply(200, { message: { content: SCRIPT }, done: true }));
  const script = await createOllamaWriter(ctx(f.fetch)).write(REQ);
  assert.equal(f.calls.length, 3);
  assert.equal(script.segments[0]?.turns.length, 2);
});

test('command: runs `claude -p` by default with the prompt on stdin', async () => {
  const s = fakeSpawn({ stdout: SCRIPT });
  const script = await createCommandWriter(ctx(forbiddenFetch().fetch, {}, { spawnImpl: s.spawn })).write(REQ);
  const [call] = s.calls;
  assert.equal(call?.command, 'claude');
  assert.deepEqual(call?.args, ['-p']);
  assert.match(call?.stdin ?? '', /Every fact must come from the stories/);
  assert.match(call?.stdin ?? '', /https:\/\/wire\.example\/rust/);
  assert.equal(script.segments[0]?.turns[0]?.text, 'Hello there.');
});

test('command: a custom command is split like a shell would', async () => {
  const s = fakeSpawn({ stdout: SCRIPT });
  await createCommandWriter(ctx(forbiddenFetch().fetch, {}, { spawnImpl: s.spawn, command: 'llm -m "big model"' })).write(REQ);
  assert.equal(s.calls[0]?.command, 'llm');
  assert.deepEqual(s.calls[0]?.args, ['-m', 'big model']);
  assert.deepEqual(splitCommand(`a 'b c' "d e" f`), ['a', 'b c', 'd e', 'f']);
});

test('command: a non-zero exit is "command-failed" with the stderr tail', async () => {
  const s = fakeSpawn({ stdout: '', stderr: 'boom: not logged in', code: 3 });
  await assert.rejects(
    createCommandWriter(ctx(forbiddenFetch().fetch, {}, { spawnImpl: s.spawn })).write(REQ),
    (e) => isDispatchError(e, 'command-failed') && /exited with code 3/.test(e.message) && /not logged in/.test(e.message),
  );
});

test('command: a missing binary says which command was not found', async () => {
  const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
  const s = fakeSpawn({ error: err });
  await assert.rejects(
    createCommandWriter(ctx(forbiddenFetch().fetch, {}, { spawnImpl: s.spawn })).write(REQ),
    (e) => isDispatchError(e, 'command-failed') && /"claude" was not found/.test(e.message),
  );
});

test('registry: resolves every writer by name and rejects unknown names', () => {
  assert.deepEqual(Object.keys(WRITERS).sort(), ['anthropic', 'command', 'ollama', 'openai']);
  const c = ctx(forbiddenFetch().fetch);
  assert.equal(getWriter('ollama', c).paid, false);
  assert.equal(getWriter('anthropic', c).paid, true);
  assert.equal(getWriter('openai', c).keyEnv, 'OPENAI_API_KEY');
  assert.throws(() => getWriter('gemini', c), (e) => isDispatchError(e, 'unknown-provider') && /anthropic, command, ollama, openai/.test(e.message));
});
