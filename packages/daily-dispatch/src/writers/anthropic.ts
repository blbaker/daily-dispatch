import { DispatchError } from '../errors.ts';
import { readJson, requireKey, sendJson } from '../http.ts';
import { textWriter } from './types.ts';
import type { ScriptWriter, WriterFactory } from './types.ts';

const URL = 'https://api.anthropic.com/v1/messages';
const KEY = 'ANTHROPIC_API_KEY';

interface MessagesReply {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
}

/** Anthropic Messages API over fetch. */
export const createAnthropicWriter: WriterFactory = (ctx): ScriptWriter =>
  textWriter(
    {
      name: 'anthropic',
      paid: true,
      keyEnv: KEY,
      price: { inputPerMTok: 2, outputPerMTok: 10, source: 'claude-sonnet-5-5 list price, platform.claude.com models overview, checked 2026-10-19' },
    },
    async (prompt, signal) => {
      const key = requireKey(ctx.env, KEY, 'anthropic');
      const res = await sendJson(
        URL,
        {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: {
            model: ctx.model ?? 'claude-sonnet-5-5',
            max_tokens: prompt.maxOutputTokens,
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
          },
        },
        { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'anthropic', keyEnv: KEY, ...(signal ? { signal } : {}) },
      );
      const data = (await readJson(res, 'anthropic')) as MessagesReply;
      if (data.stop_reason === 'max_tokens') {
        throw new DispatchError('bad-response', 'anthropic: the script was cut off at max_tokens; ask for a shorter episode with --minutes');
      }
      const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      if (text.trim() === '') throw new DispatchError('bad-response', 'anthropic: the reply had no text');
      return text;
    },
  );
