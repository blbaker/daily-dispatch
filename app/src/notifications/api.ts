// HTTP client for the push routes of the backend (see docs/push-setup.md).
// fetch is injected so tests can run it without a network.
import type { FeedNotification, NotificationPrefs } from "./types";

export class PushApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PushApiError";
    this.status = status;
  }
}

export interface Registration {
  platform: string;
  kind: string;
  token?: string;
  subscription?: unknown;
}

export interface PushConfig {
  expo: { enabled: boolean };
  webpush: { enabled: boolean; vapidPublicKey: string | null };
}

export interface FeedPage {
  notifications: FeedNotification[];
  cursor: string;
  more?: boolean;
}

export interface Episode {
  id: string;
  title?: string;
  audioUrl?: string;
}

export interface PushApi {
  readonly configured: boolean;
  registerDevice(reg: Registration): Promise<string>;
  pushConfig(): Promise<PushConfig>;
  putSettings(notifications: Partial<NotificationPrefs>): Promise<void>;
  notificationsSince(ts: string, deviceId: string): Promise<FeedPage>;
  getEpisode(id: string): Promise<Episode>;
}

export interface PushApiOptions {
  /** A function is read on every request, so a server changed in Settings applies at once. */
  baseUrl: string | (() => string);
  apiKey: string | (() => string);
  fetch?: typeof fetch;
}

export function createPushApi({ baseUrl, apiKey, fetch: fetchFn }: PushApiOptions): PushApi {
  const read = (v: string | (() => string)) => (typeof v === "function" ? v() : v);
  const base = () => read(baseUrl).replace(/\/$/, "");
  const key = () => read(apiKey);
  const doFetch = fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base()}${path}`, {
      method,
      headers: { "x-api-key": key(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      // A body that is not JSON is reported by status alone.
    }
    if (!res.ok) {
      const why = payload && typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`;
      throw new PushApiError(res.status, why);
    }
    return payload as T;
  }

  return {
    get configured() {
      return Boolean(base() && key());
    },
    async registerDevice(reg) {
      const out = await call<{ device: { id: string } }>("POST", "/devices", reg);
      return out.device.id;
    },
    pushConfig: () => call<PushConfig>("GET", "/push/config"),
    async putSettings(notifications) {
      await call("PUT", "/settings", { notifications });
    },
    notificationsSince: (ts, deviceId) =>
      call<FeedPage>(
        "GET",
        `/notifications/since?ts=${encodeURIComponent(ts)}&device=${encodeURIComponent(deviceId)}`,
      ),
    getEpisode: (id) => call<Episode>("GET", `/episodes/${encodeURIComponent(id)}`),
  };
}
