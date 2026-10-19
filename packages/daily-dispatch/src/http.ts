import { DispatchError } from './errors.ts';
import type { Env } from './context.ts';

export interface HttpOptions {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Provider name for error messages. */
  provider: string;
  /** Env var holding the key, named in the "unauthorized" message. */
  keyEnv?: string;
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  signal?: AbortSignal;
}

export interface JsonRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Serialised as JSON. Omit for GET. */
  body?: unknown;
  /** Sent exactly as given (SSML, or JSON that was signed); the caller sets content-type. */
  raw?: string;
}

/**
 * Statuses worth another try. 409 is ElevenLabs' `already_running`, which
 * happens when parallel requests both auto-add the same Voice Library voice;
 * it clears on its own.
 */
const RETRY = new Set([409, 429, 500, 502, 503, 504]);
const BASE_DELAY_MS = 5000;

/**
 * fetch with the retry and error mapping every provider adapter shares.
 * Returns the response only when it is 2xx; every failure is a
 * DispatchError with a kind the CLI can explain.
 */
export async function sendJson(url: string, req: JsonRequest, opts: HttpOptions): Promise<Response> {
  const retries = opts.retries ?? 3;
  const payload = req.raw ?? (req.body === undefined ? undefined : JSON.stringify(req.body));
  const method = req.method ?? (payload === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { ...req.headers };
  if (req.raw === undefined && req.body !== undefined) headers['content-type'] = 'application/json';
  const host = new URL(url).host;

  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retries;
    let res: Response;
    try {
      const init: RequestInit = { method, headers };
      if (payload !== undefined) init.body = payload;
      if (opts.signal !== undefined) init.signal = opts.signal;
      res = await opts.fetchImpl(url, init);
    } catch (e) {
      if (!last && !opts.signal?.aborted) {
        await opts.sleep(BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      throw new DispatchError('network', `${opts.provider}: could not reach ${host}: ${(e as Error).message}`);
    }
    if (res.ok) return res;
    if (RETRY.has(res.status) && !last) {
      await res.body?.cancel();
      await opts.sleep(BASE_DELAY_MS * 2 ** attempt);
      continue;
    }
    const excerpt = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      const hint = opts.keyEnv === undefined ? '' : ` Check ${opts.keyEnv}.`;
      throw new DispatchError('unauthorized', `${opts.provider} rejected the API key (HTTP ${res.status}).${hint}`, [excerpt]);
    }
    if (res.status === 429) {
      throw new DispatchError('rate-limited', `${opts.provider} is rate limiting requests (HTTP 429). Try again later.`, [excerpt]);
    }
    throw new DispatchError('http', `${opts.provider}: HTTP ${res.status} from ${host}: ${excerpt}`, [excerpt]);
  }
}

/** Read a JSON body, turning a non-JSON 2xx into a "bad-response" error. */
export async function readJson(res: Response, provider: string): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new DispatchError('bad-response', `${provider}: expected JSON, got: ${text.slice(0, 120)}`);
  }
}

/** Read an audio body; an empty 2xx would become a silent gap in the episode. */
export async function readAudio(res: Response, provider: string): Promise<Uint8Array> {
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.length === 0) throw new DispatchError('bad-response', `${provider}: the reply had no audio`);
  return audio;
}

/** Keys come only from the environment. */
export function requireKey(env: Env, name: string, provider: string): string {
  const key = env[name]?.trim();
  if (key === undefined || key === '') {
    throw new DispatchError('no-key', `${provider} needs an API key: set the ${name} environment variable.`);
  }
  return key;
}
