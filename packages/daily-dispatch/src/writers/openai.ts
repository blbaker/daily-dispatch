import { DispatchError } from '../errors.ts';
import { readJson, requireKey, sendJson } from '../http.ts';
import { textWriter } from './types.ts';
import type { ScriptWriter, WriterFactory } from './types.ts';

const URL = 'https://api.openai.com/v1/chat/completions';
const KEY = 'OPENAI_API_KEY';

interface ChatReply {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
}

/** OpenAI Chat Completions over fetch. */
export const createOpenAIWriter: WriterFactory = (ctx): ScriptWriter =>
  textWriter(
    {
      name: 'openai',
      paid: true,
      keyEnv: KEY,
      price: { inputPerMTok: 2, outputPerMTok: 10, source: 'gpt-6.1-sol list price, developers.openai.com/api/docs/pricing, checked 2026-10-19' },
    },
    async (prompt, signal) => {
      const key = requireKey(ctx.env, KEY, 'openai');
      const res = await sendJson(
        URL,
        {
          headers: { authorization: `Bearer ${key}` },
          body: {
            model: ctx.model ?? 'gpt-6.1-sol',
            max_completion_tokens: prompt.maxOutputTokens,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
          },
        },
        { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'openai', keyEnv: KEY, ...(signal ? { signal } : {}) },
      );
      const choice = ((await readJson(res, 'openai')) as ChatReply).choices?.[0];
      if (choice?.finish_reason === 'length') {
        throw new DispatchError('bad-response', 'openai: the script was cut off at the token limit; ask for a shorter episode with --minutes');
      }
      const text = choice?.message?.content ?? '';
      if (text.trim() === '') throw new DispatchError('bad-response', 'openai: the reply had no text');
      return text;
    },
  );
