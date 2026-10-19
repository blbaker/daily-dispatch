// Notification prefs (master, new edition, new episode). Stored on the
// device first, then sent to PUT /settings. A change made offline stays
// marked dirty and goes out on the next sync(). The Settings screen binds to
// this through the functions exported from ./index.
import type { PushApi } from "./api";
import type { KeyValueStore, NotificationPrefs, PrefsState } from "./types";

export const PREFS_KEY = "dd.notifications.prefs";
export const DEFAULT_PREFS: NotificationPrefs = Object.freeze({ enabled: true, newEdition: true, newEpisode: true });
const KEYS = ["enabled", "newEdition", "newEpisode"] as const;

export interface PrefsStore {
  state(): Promise<PrefsState>;
  get(): Promise<NotificationPrefs>;
  /** Saves locally, tells subscribers, then tries PUT /settings. */
  set(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs>;
  /** Sends a pending change. Resolves true when nothing is left to send. */
  sync(): Promise<boolean>;
  subscribe(fn: (prefs: NotificationPrefs) => void): () => void;
}

function check(patch: Partial<NotificationPrefs>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (!(KEYS as readonly string[]).includes(k)) throw new TypeError(`${k} is not a notification pref`);
    if (typeof v !== "boolean") throw new TypeError(`${k} must be true or false`);
  }
}

function parse(raw: string | null): PrefsState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    const prefs = { ...DEFAULT_PREFS };
    for (const k of KEYS) if (typeof s?.prefs?.[k] === "boolean") prefs[k] = s.prefs[k];
    return { prefs, updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : null, dirty: s.dirty === true };
  } catch {
    return null;
  }
}

export function createPrefsStore(opts: { api: PushApi; storage: KeyValueStore; now?: () => number }): PrefsStore {
  const now = opts.now ?? Date.now;
  const subs = new Set<(p: NotificationPrefs) => void>();
  let cached: PrefsState | null = null;
  let version = 0;

  async function state(): Promise<PrefsState> {
    if (!cached) {
      cached = parse(await opts.storage.getItem(PREFS_KEY)) ?? { prefs: { ...DEFAULT_PREFS }, updatedAt: null, dirty: false };
    }
    return { ...cached, prefs: { ...cached.prefs } };
  }

  async function save(s: PrefsState): Promise<void> {
    cached = s;
    await opts.storage.setItem(PREFS_KEY, JSON.stringify(s));
  }

  async function sync(): Promise<boolean> {
    const s = await state();
    if (!s.dirty) return true;
    const sent = version;
    try {
      await opts.api.putSettings(s.prefs);
    } catch {
      return false;
    }
    // A change made while the request was in flight still needs sending.
    if (sent === version) await save({ ...(await state()), dirty: false });
    return sent === version;
  }

  return {
    state,
    get: async () => (await state()).prefs,
    async set(patch) {
      check(patch);
      const s = await state();
      const prefs = { ...s.prefs, ...patch };
      version++;
      await save({ prefs, updatedAt: now(), dirty: true });
      for (const fn of subs) fn({ ...prefs });
      await sync();
      return prefs;
    },
    sync,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}
