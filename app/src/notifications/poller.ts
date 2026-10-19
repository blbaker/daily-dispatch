// The desktop poller. Impeller desktop builds have no OS push service, so
// while the app runs it reads GET /notifications/since every 5 minutes and
// hands each new notification to `show`. The cursor is stored, so a restart
// picks up where the last poll stopped; the very first run starts at "now"
// so an install does not replay old editions.
import { PushApiError, type PushApi } from "./api";
import type { FeedNotification, KeyValueStore } from "./types";

export const POLL_MS = 5 * 60 * 1000;
export const CURSOR_KEY = "dd.push.cursor";
const MAX_PAGES = 5;

export interface Timers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface PollerOptions {
  api: PushApi;
  storage: KeyValueStore;
  deviceId(): string | null;
  /** Registers again after a 404 and returns the new device id. */
  reregister(): Promise<string | null>;
  show(n: FeedNotification): Promise<void>;
  intervalMs?: number;
  timers?: Timers;
  now?: () => number;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** One poll. Resolves with how many notifications were shown. */
  pollOnce(): Promise<number>;
}

const defaultTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export function createPoller(opts: PollerOptions): Poller {
  const timers = opts.timers ?? defaultTimers;
  const intervalMs = opts.intervalMs ?? POLL_MS;
  const now = opts.now ?? Date.now;
  let handle: unknown = null;
  let busy = false;

  async function fetchPage(cursor: string) {
    const id = opts.deviceId();
    if (!id) return null;
    try {
      return await opts.api.notificationsSince(cursor, id);
    } catch (e) {
      if (!(e instanceof PushApiError) || e.status !== 404) throw e;
      const fresh = await opts.reregister();
      return fresh ? opts.api.notificationsSince(cursor, fresh) : null;
    }
  }

  async function pollOnce(): Promise<number> {
    if (busy) return 0;
    busy = true;
    let shown = 0;
    try {
      let cursor = await opts.storage.getItem(CURSOR_KEY);
      if (!cursor) {
        cursor = new Date(now()).toISOString();
        await opts.storage.setItem(CURSOR_KEY, cursor);
      }
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetchPage(cursor);
        if (!res) break;
        for (const n of res.notifications) {
          await opts.show(n);
          shown++;
        }
        cursor = res.cursor;
        await opts.storage.setItem(CURSOR_KEY, cursor);
        if (!res.more) break;
      }
    } catch {
      // Offline or a server error: keep the stored cursor and try next tick.
    } finally {
      busy = false;
    }
    return shown;
  }

  return {
    start() {
      if (handle !== null) return;
      void pollOnce();
      handle = timers.setInterval(() => void pollOnce(), intervalMs);
    },
    stop() {
      if (handle === null) return;
      timers.clearInterval(handle);
      handle = null;
    },
    pollOnce,
  };
}
