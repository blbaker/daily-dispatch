// The Settings screen's store. Every change is saved on the device first.
// Reading and server settings stay on the device. The podcast section also
// lives on the backend (GET/PUT /settings), because the daily episode job
// reads it there; it syncs right after each change, and again on sync().
//
// Conflicts: when the podcast section changed both here and on the backend
// since the last sync, the later edit wins. "Later" compares this device's
// clock (when the edit was made here) with the backend's updatedAt (when its
// last PUT landed). The backend bumps updatedAt for notification changes
// too, so a remote edit only counts when the podcast section itself differs
// from what this device last saw there.
import type {
  KeyValueStore, PodcastSettings, ReadingSettings, RemoteSettings, ServerSettings, SettingsApi,
  SettingsState,
} from "./types";
import { isObj, podcastRules, readingRules, sameJson, serverRules } from "./validate";

export const SETTINGS_KEY = "dd.settings";

/** The backend's defaults (backend/lambda/settings.ts). */
export const DEFAULT_PODCAST: PodcastSettings = Object.freeze({
  enabled: false,
  time: "06:00",
  timezone: "UTC",
  voiceProvider: "elevenlabs",
  scriptWriter: "command",
  hostVoices: Object.freeze({}) as Record<string, string>,
});
export const DEFAULT_READING: ReadingSettings = Object.freeze({ textScale: 1, eink: false });
const DEFAULT_SERVER: ServerSettings = Object.freeze({ apiUrl: null, apiKey: null });

function fresh(): SettingsState {
  return {
    podcast: { ...DEFAULT_PODCAST, hostVoices: {} },
    reading: { ...DEFAULT_READING },
    server: { ...DEFAULT_SERVER },
    sync: { updatedAt: null, dirty: false, base: null, syncedAt: null, error: null },
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parse(raw: string | null): SettingsState {
  const s = fresh();
  if (!raw) return s;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return s;
  }
  if (!isObj(o)) return s;
  const sync = isObj(o.sync) ? o.sync : {};
  return {
    podcast: podcastRules.repair(o.podcast, s.podcast),
    reading: readingRules.repair(o.reading, s.reading),
    server: serverRules.repair(o.server, s.server),
    sync: {
      updatedAt: num(sync.updatedAt),
      dirty: sync.dirty === true,
      base: isObj(sync.base) ? podcastRules.repair(sync.base, s.podcast) : null,
      syncedAt: num(sync.syncedAt),
      error: typeof sync.error === "string" ? sync.error : null,
    },
  };
}

const clone = (s: SettingsState): SettingsState => structuredClone(s);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface SettingsStore {
  state(): Promise<SettingsState>;
  /** Saves locally, tells subscribers, then syncs. Never rejects for a network error. */
  setPodcast(patch: Partial<PodcastSettings>): Promise<SettingsState>;
  setReading(patch: Partial<ReadingSettings>): Promise<SettingsState>;
  setServer(patch: Partial<ServerSettings>): Promise<SettingsState>;
  /** Resolves true when the backend and this device agree. */
  sync(): Promise<boolean>;
  subscribe(fn: (s: SettingsState) => void): () => void;
}

export function createSettingsStore(opts: {
  storage: KeyValueStore;
  api: SettingsApi;
  now?: () => number;
}): SettingsStore {
  const now = opts.now ?? Date.now;
  const subs = new Set<(s: SettingsState) => void>();
  let cached: SettingsState | null = null;
  let loading: Promise<SettingsState> | null = null;
  let version = 0; // bumped by every podcast edit
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<SettingsState> {
    if (cached) return cached;
    loading ??= opts.storage.getItem(SETTINGS_KEY).then((raw) => (cached ??= parse(raw)));
    return loading;
  }

  async function save(next: SettingsState): Promise<SettingsState> {
    cached = next;
    await opts.storage.setItem(SETTINGS_KEY, JSON.stringify(next));
    const copy = clone(next);
    for (const fn of subs) fn(clone(copy));
    return copy;
  }

  // Remote wins only for a real remote edit that is newer than ours.
  function remoteWins(s: SettingsState, remote: RemoteSettings): boolean {
    if (!s.sync.dirty) return true;
    const changedThere = s.sync.base === null || !sameJson(remote.podcast, s.sync.base);
    if (!changedThere) return false;
    const there = remote.updatedAt ? Date.parse(remote.updatedAt) : Number.NEGATIVE_INFINITY;
    return there > (s.sync.updatedAt ?? Number.NEGATIVE_INFINITY);
  }

  async function syncOnce(): Promise<boolean> {
    const sent = version;
    let s = await load();
    try {
      const remote = await opts.api.get();
      s = await load();
      if (remoteWins(s, remote)) {
        if (version !== sent) return false; // an edit landed meanwhile; the next sync decides
        const podcast = podcastRules.repair(remote.podcast, s.podcast);
        await save({ ...s, podcast, sync: { ...s.sync, dirty: false, base: podcast, syncedAt: now(), error: null } });
        return true;
      }
      const res = await opts.api.putPodcast(s.podcast);
      s = await load();
      const base = podcastRules.repair(res.podcast, s.podcast);
      const done = version === sent;
      await save({ ...s, sync: { ...s.sync, dirty: !done, base, syncedAt: now(), error: null } });
      return done;
    } catch (e) {
      s = await load();
      await save({ ...s, sync: { ...s.sync, error: message(e) } });
      return false;
    }
  }

  // One sync at a time, so two PUTs never race each other.
  function sync(): Promise<boolean> {
    const run = queue.then(syncOnce, syncOnce);
    queue = run;
    return run;
  }

  return {
    state: async () => clone(await load()),
    async setPodcast(patch) {
      podcastRules.check(patch);
      const s = await load();
      version++;
      await save({
        ...s,
        podcast: { ...s.podcast, ...structuredClone(patch) },
        sync: { ...s.sync, dirty: true, updatedAt: now() },
      });
      await sync();
      return clone(await load());
    },
    async setReading(patch) {
      readingRules.check(patch);
      const s = await load();
      return save({ ...s, reading: { ...s.reading, ...patch } });
    },
    async setServer(patch) {
      serverRules.check(patch);
      const s = await load();
      return save({ ...s, server: { ...s.server, ...patch } });
    },
    sync,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}
