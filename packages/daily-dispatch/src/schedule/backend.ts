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

async function send(b: Backend, pathname: string, fetchImpl: typeof fetch, json?: unknown): Promise<Response> {
  const url = `${b.url}${pathname}`;
  const headers: Record<string, string> = { 'x-api-key': b.key, accept: 'application/json' };
  const init: RequestInit = { method: json === undefined ? 'GET' : 'POST', headers };
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    throw new DispatchError('network', `could not reach the backend at ${new URL(url).host}: ${(e as Error).message}`);
  }
}

async function readReply(res: Response, pathname: string): Promise<unknown> {
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

/**
 * GET a backend path with the API key. Returns null on 404, which callers
 * treat as "not there yet". No retries here: the scheduler polls again in a
 * few minutes anyway.
 */
export async function backendGet(b: Backend, pathname: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await send(b, pathname, fetchImpl);
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  return readReply(res, pathname);
}

/** POST JSON to a backend path with the API key. A 404 here is an error: the backend predates the route. */
export async function backendPost(b: Backend, pathname: string, body: unknown, fetchImpl: typeof fetch): Promise<unknown> {
  return readReply(await send(b, pathname, fetchImpl, body), pathname);
}
