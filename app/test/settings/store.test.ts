// Settings store: local first, then the podcast section syncs with backend
// /settings. Conflicts resolve last write wins by timestamp.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PODCAST, SETTINGS_KEY, createSettingsStore,
} from "../../src/settings/store";
import type { PodcastSettings, RemoteSettings, SettingsApi } from "../../src/settings/types";
import { memoryStore } from "../notifications/helpers";

const T0 = Date.parse("2026-10-19T15:00:00Z");
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** An in-memory backend with a switch for being offline. */
function fakeBackend(podcast: Partial<PodcastSettings> = {}, updatedAt: string | null = null) {
  const b = {
    online: true,
    remote: { podcast: { ...DEFAULT_PODCAST, ...podcast }, updatedAt } as RemoteSettings,
    puts: [] as PodcastSettings[],
    gets: 0,
    clock: T0 + 60_000,
  };
  const api: SettingsApi = {
    async get() {
      b.gets++;
      if (!b.online) throw new Error("HTTP 503");
      return copy(b.remote);
    },
    async putPodcast(p) {
      if (!b.online) throw new Error("HTTP 503");
      b.puts.push(copy(p));
      b.remote = { podcast: copy(p), updatedAt: new Date(b.clock).toISOString() };
      return copy(b.remote);
    },
  };
  return { b, api };
}

function setup(seed: Record<string, string> = {}, remote = fakeBackend()) {
  const storage = memoryStore(seed);
  let t = T0;
  const clock = { set: (ms: number) => (t = ms) };
  const store = createSettingsStore({ storage, api: remote.api, now: () => t });
  return { store, storage, clock, ...remote };
}

const saved = (storage: { data: Map<string, string> }) => JSON.parse(storage.data.get(SETTINGS_KEY)!);

describe("settings store: load", () => {
  it("runs where structuredClone and Object.hasOwn do not exist (Hermes)", async () => {
    const sc = globalThis.structuredClone;
    const own = Object.hasOwn;
    // @ts-expect-error removing globals the store must not depend on
    delete globalThis.structuredClone;
    // @ts-expect-error same
    delete Object.hasOwn;
    let textScale: number;
    let hostVoices: unknown;
    try {
      const { store, b } = setup();
      await store.setReading({ textScale: 1.125 });
      const s = await store.setPodcast({ enabled: true, hostVoices: { A: "nova" } });
      textScale = s.reading.textScale;
      hostVoices = b.remote.podcast.hostVoices;
    } finally {
      globalThis.structuredClone = sc;
      Object.hasOwn = own;
    }
    // Asserted after the globals are back, because expect() itself uses them.
    expect(textScale).toBe(1.125);
    expect(hostVoices).toEqual({ A: "nova" });
  });
  it("starts from the backend defaults and plain reading settings", async () => {
    const { store } = setup();
    const s = await store.state();
    expect(s.podcast).toEqual({
      enabled: false, time: "06:00", timezone: "UTC", voiceProvider: "elevenlabs",
      scriptWriter: "command", hostVoices: {},
    });
    expect(s.reading).toEqual({ textScale: 1, eink: false });
    expect(s.server).toEqual({ apiUrl: null, apiKey: null });
    expect(s.sync).toMatchObject({ dirty: false, updatedAt: null, base: null });
  });

  it("reads what an earlier run saved", async () => {
    const first = setup();
    await first.store.setReading({ textScale: 1.25, eink: true });
    await first.store.setServer({ apiUrl: "https://dispatch.test" });
    const again = createSettingsStore({ storage: first.storage, api: fakeBackend().api });
    const s = await again.state();
    expect(s.reading).toEqual({ textScale: 1.25, eink: true });
    expect(s.server.apiUrl).toBe("https://dispatch.test");
  });

  it("falls back to defaults for a corrupt value and for fields that fail validation", async () => {
    expect((await setup({ [SETTINGS_KEY]: "{not json" }).store.state()).reading.textScale).toBe(1);
    const bad = JSON.stringify({ reading: { textScale: 3, eink: "yes" }, podcast: { time: "25:00", enabled: true } });
    const s = await setup({ [SETTINGS_KEY]: bad }).store.state();
    expect(s.reading).toEqual({ textScale: 1, eink: false });
    expect(s.podcast.time).toBe("06:00");
    expect(s.podcast.enabled).toBe(true);
  });
});

describe("settings store: save", () => {
  it("saves reading and server settings on the device only", async () => {
    const { store, storage, b } = setup();
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.reading.textScale));
    await store.setReading({ textScale: 0.875 });
    await store.setServer({ apiKey: "k-1" });
    expect(saved(storage).reading.textScale).toBe(0.875);
    expect(saved(storage).server.apiKey).toBe("k-1");
    expect(seen).toEqual([0.875, 0.875]);
    expect(b.puts).toHaveLength(0);
    expect(b.gets).toBe(0);
  });

  it("saves a podcast change locally, then sends the whole section to the backend", async () => {
    const { store, storage, b } = setup();
    const s = await store.setPodcast({ enabled: true, time: "07:30" });
    expect(b.puts).toEqual([{ ...DEFAULT_PODCAST, enabled: true, time: "07:30" }]);
    expect(s.sync).toMatchObject({ dirty: false, updatedAt: T0, syncedAt: T0, error: null });
    expect(s.sync.base).toEqual(b.remote.podcast);
    expect(saved(storage).sync.dirty).toBe(false);
  });

  it("rejects bad values without saving or calling the backend", async () => {
    const { store, storage, b } = setup();
    await expect(store.setPodcast({ time: "25:00" })).rejects.toThrow(/time/);
    await expect(store.setPodcast({ voiceProvider: "Eleven Labs" })).rejects.toThrow(/voiceProvider/);
    await expect(store.setPodcast({ hostVoices: { a: "" } })).rejects.toThrow(/hostVoices/);
    await expect(store.setReading({ textScale: 2 as never })).rejects.toThrow(/textScale/);
    expect(storage.data.has(SETTINGS_KEY)).toBe(false);
    expect(b.puts).toHaveLength(0);
  });
});

describe("settings store: sync", () => {
  it("keeps an offline edit across a restart and sends it when the backend is back", async () => {
    const first = setup();
    first.b.online = false;
    const s = await first.store.setPodcast({ time: "05:30" });
    expect(s.sync).toMatchObject({ dirty: true, error: "HTTP 503" });

    const again = createSettingsStore({ storage: first.storage, api: first.api });
    expect((await again.state()).sync.dirty).toBe(true);
    first.b.online = true;
    expect(await again.sync()).toBe(true);
    expect(first.b.remote.podcast.time).toBe("05:30");
    expect((await again.state()).sync).toMatchObject({ dirty: false, error: null });
  });

  it("takes the backend's podcast section when nothing changed here", async () => {
    const { store, b } = setup({}, fakeBackend({ enabled: true, time: "08:00" }, "2026-10-19T14:00:00Z"));
    expect(await store.sync()).toBe(true);
    expect((await store.state()).podcast).toMatchObject({ enabled: true, time: "08:00" });
    expect(b.puts).toHaveLength(0);
  });

  it("conflict: a newer edit on the backend wins over an older one here", async () => {
    const { store, b } = setup();
    await store.sync(); // base = defaults
    b.online = false;
    await store.setPodcast({ time: "05:00" }); // edited here at T0
    b.remote = { podcast: { ...DEFAULT_PODCAST, time: "09:00" }, updatedAt: new Date(T0 + 5_000).toISOString() };
    b.online = true;
    expect(await store.sync()).toBe(true);
    const s = await store.state();
    expect(s.podcast.time).toBe("09:00");
    expect(s.sync.dirty).toBe(false);
    expect(b.puts).toHaveLength(0);
  });

  it("conflict: a newer edit here wins over an older one on the backend", async () => {
    const { store, b, clock } = setup();
    await store.sync();
    b.online = false;
    b.remote = { podcast: { ...DEFAULT_PODCAST, time: "09:00" }, updatedAt: new Date(T0 + 5_000).toISOString() };
    clock.set(T0 + 9_000);
    await store.setPodcast({ time: "05:00" });
    b.online = true;
    expect(await store.sync()).toBe(true);
    expect(b.remote.podcast.time).toBe("05:00");
    expect((await store.state()).podcast.time).toBe("05:00");
  });

  it("is not a conflict when only the backend's timestamp moved", async () => {
    // A notifications PUT bumps updatedAt without touching the podcast section.
    const { store, b } = setup();
    await store.sync();
    b.online = false;
    await store.setPodcast({ enabled: true });
    b.remote = { ...b.remote, updatedAt: new Date(T0 + 5_000).toISOString() };
    b.online = true;
    await store.sync();
    expect(b.remote.podcast.enabled).toBe(true);
  });

  it("does not lose an edit made while a PUT is in flight", async () => {
    // If the first PUT marked the state clean, the next sync would adopt the
    // backend's 05:00 and throw away 05:30.
    const { store, b, api } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const put = api.putPodcast;
    let n = 0;
    api.putPodcast = async (p) => {
      if (++n === 1) await gate;
      return put(p);
    };
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const first = store.setPodcast({ time: "05:00" });
    await tick();
    const second = store.setPodcast({ time: "05:30" });
    await tick();
    release();
    await Promise.all([first, second]);
    const s = await store.state();
    expect(s.podcast.time).toBe("05:30");
    expect(b.remote.podcast.time).toBe("05:30");
    expect(s.sync.dirty).toBe(false);
  });
});
