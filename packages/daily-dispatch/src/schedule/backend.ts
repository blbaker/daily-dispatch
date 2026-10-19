import { DispatchError } from '../errors.ts';
import type { Env } from '../context.ts';

export const API_URL_ENV = 'DAILY_DISPATCH_API_URL';
export const API_KEY_ENV = 'DAILY_DISPATCH_API_KEY';

export interface Backend {
  url: string;
  key: string;
}

/** The backend is used only when both the URL and the key are set. */
export function backendFrom(env: Env): Backend | undefined {
  const url = env[API_URL_ENV]?.trim();
  const key = env[API_KEY_ENV]?.trim();
  return url && key ? { url: url.replace(/\/+$/, ''), key } : undefined;
}

/**
 * GET a backend path with the API key. Returns null on 404, which callers
 * treat as "not there yet". No retries here: the scheduler polls again in a
 * few minutes anyway.
 */
export async function backendGet(b: Backend, pathname: string, fetchImpl: typeof fetch): Promise<unknown> {
  const url = `${b.url}${pathname}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { 'x-api-key': b.key, accept: 'application/json' } });
  } catch (e) {
    throw new DispatchError('network', `could not reach the backend at ${new URL(url).host}: ${(e as Error).message}`);
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new DispatchError('unauthorized', `the backend rejected the API key (HTTP ${res.status}). Check ${API_KEY_ENV}.`);
  }
  if (!res.ok) throw new DispatchError('http', `backend: HTTP ${res.status} for ${pathname}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new DispatchError('bad-response', `backend: expected JSON from ${pathname}, got: ${text.slice(0, 120)}`);
  }
}
