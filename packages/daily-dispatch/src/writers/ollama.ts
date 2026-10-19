import { DispatchError } from '../errors.ts';
import { readJson, sendJson } from '../http.ts';
import { textWriter } from './types.ts';
import type { ScriptWriter, WriterFactory } from './types.ts';

interface ChatReply {
  message?: { content?: string };
  done_reason?: string;
}

/** OLLAMA_HOST follows the Ollama CLI's convention: "host:port" or a full URL. */
export function ollamaBase(host: string | undefined): string {
  const h = (host ?? '').trim() || '127.0.0.1:11434';
  return (/^https?:\/\//.test(h) ? h : `http://${h}`).replace(/\/+$/, '');
}

/**
 * Local Ollama /api/chat. Free, so it runs even in a dry run. Ollama's
 * default context window (a few thousand tokens) would silently truncate a
 * day's stories, so num_ctx is sized to the prompt plus the reply. Small
 * local models slip on the format more often, so they get three attempts.
 */
export const createOllamaWriter: WriterFactory = (ctx): ScriptWriter =>
  textWriter({ name: 'ollama', paid: false }, async (prompt, signal) => {
    const promptTokens = Math.ceil((prompt.system.length + prompt.user.length) / 3);
    const numCtx = Math.min(131072, Math.max(8192, promptTokens + prompt.maxOutputTokens));
    const res = await sendJson(
      `${ollamaBase(ctx.env['OLLAMA_HOST'])}/api/chat`,
      {
        body: {
          model: ctx.model ?? (ctx.env['OLLAMA_MODEL']?.trim() || 'llama3.1:8b'),
          stream: false,
          options: { num_ctx: numCtx },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        },
      },
      // One retry: a local server that refuses twice is not running.
      { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'ollama', retries: 1, ...(signal ? { signal } : {}) },
    );
    const data = (await readJson(res, 'ollama')) as ChatReply;
    if (data.done_reason === 'length') {
      throw new DispatchError('bad-response', 'ollama: the script was cut off at the context limit; ask for a shorter episode with --minutes');
    }
    const text = data.message?.content ?? '';
    if (text.trim() === '') throw new DispatchError('bad-response', 'ollama: the reply had no text');
    return text;
  }, 3); // free and local, so a third try at the format costs nothing
