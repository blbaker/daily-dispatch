// HTTP for the Settings screen: the podcast section of GET/PUT /settings,
// and the Server section's connection test against GET /health. fetch is
// injected so the tests run without a network.
import type { PodcastSettings, RemoteSettings, ServerSettings, SettingsApi } from "./types";
import { isObj } from "./validate";

export interface Server {
  baseUrl: string;
  apiKey: string;
}

/** This device's override where it has one, else the value the build shipped with. */
export function effectiveServer(own: ServerSettings, build: Server): Server {
  return {
    baseUrl: (own.apiUrl ?? build.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: (own.apiKey ?? build.apiKey).trim(),
  };
}

const defaultFetch: typeof fetch = (...args) => fetch(...args);

async function errorOf(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isObj(body) && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; the status says enough.
  }
  return `HTTP ${res.status}`;
}

function toRemote(body: unknown): RemoteSettings {
  if (!isObj(body) || !isObj(body.podcast)) throw new Error("/settings has no podcast section");
  return {
    podcast: body.podcast as unknown as PodcastSettings,
    updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
  };
}

export function createSettingsApi(opts: { server: () => Server; fetch?: typeof fetch }): SettingsApi {
  const doFetch = opts.fetch ?? defaultFetch;

  async function call(method: "GET" | "PUT", body?: unknown): Promise<RemoteSettings> {
    const { baseUrl, apiKey } = opts.server();
    if (!baseUrl || !apiKey) throw new Error("No server set");
    const res = await doFetch(`${baseUrl.replace(/\/+$/, "")}/settings`, {
      method,
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(await errorOf(res));
    return toRemote(await res.json());
  }

  return {
    get: () => call("GET"),
    putPodcast: (podcast) => call("PUT", { podcast }),
  };
}

export type ConnectionResult =
  | { state: "ok"; ms: number }
  | { state: "bad-key"; ms: number }
  | { state: "error"; detail: string };

/**
 * GET /health needs no key, so it proves only that the URL answers. A second
 * call to GET /settings proves the key, which is what every other request
 * needs.
 */
export async function testConnection(
  server: Server,
  opts: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<ConnectionResult> {
  const doFetch = opts.fetch ?? defaultFetch;
  const now = opts.now ?? Date.now;
  const base = server.baseUrl.trim().replace(/\/+$/, "");
  if (!base) return { state: "error", detail: "Enter the API URL first" };
  const headers = { "x-api-key": server.apiKey.trim() };
  try {
    const start = now();
    const health = await doFetch(`${base}/health`, { headers, cache: "no-store" });
    const ms = Math.round(now() - start);
    if (!health.ok) return { state: "error", detail: `/health answered HTTP ${health.status}` };
    const settings = await doFetch(`${base}/settings`, { headers, cache: "no-store" });
    if (settings.status === 401 || settings.status === 403) return { state: "bad-key", ms };
    if (!settings.ok) return { state: "error", detail: `/settings answered HTTP ${settings.status}` };
    return { state: "ok", ms };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}
