// Shared test doubles: a fetch that records calls and answers from a route
// table, and an in-memory key-value store.
import type { KeyValueStore } from "../../src/notifications/types";

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: any;
}

type Handler = (call: Call) => [number, unknown] | Promise<[number, unknown]>;

export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const call: Call = { method, url, headers, body };
    calls.push(call);
    const path = new URL(url).pathname;
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ error: `no mock for ${method} ${path}` }), { status: 404 });
    const [status, payload] = await handler(call);
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchFn as typeof fetch, calls };
}

export function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
  };
}

export const BASE = "http://api.test";
export const KEY = "test-key";
