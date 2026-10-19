import { describe, expect, it } from "vitest";
import { createPushApi } from "../../src/notifications/api";
import { DEFAULT_PREFS, PREFS_KEY, createPrefsStore } from "../../src/notifications/prefs";
import { BASE, KEY, memoryStore, mockFetch } from "./helpers";

function setup(putStatus: () => number = () => 200, seed: Record<string, string> = {}) {
  const m = mockFetch({ "PUT /settings": () => [putStatus(), putStatus() === 200 ? {} : { error: "down" }] });
  const api = createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch });
  const storage = memoryStore(seed);
  let t = 1000;
  const store = createPrefsStore({ api, storage, now: () => ++t });
  return { store, storage, m };
}

describe("notification prefs", () => {
  it("defaults to everything on", async () => {
    const { store } = setup();
    expect(await store.get()).toEqual({ enabled: true, newEdition: true, newEpisode: true });
    expect(DEFAULT_PREFS).toEqual({ enabled: true, newEdition: true, newEpisode: true });
  });

  it("saves a change locally and pushes all three switches to PUT /settings", async () => {
    const { store, storage, m } = setup();
    const prefs = await store.set({ newEpisode: false });
    expect(prefs).toEqual({ enabled: true, newEdition: true, newEpisode: false });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].body).toEqual({ notifications: { enabled: true, newEdition: true, newEpisode: false } });
    const saved = JSON.parse(storage.data.get(PREFS_KEY)!);
    expect(saved).toMatchObject({ prefs: prefs, dirty: false });
    expect(typeof saved.updatedAt).toBe("number");
  });

  it("keeps an offline change marked dirty and sends it on the next sync", async () => {
    let status = 503;
    const { store, m } = setup(() => status);
    await store.set({ enabled: false });
    expect((await store.state()).dirty).toBe(true);
    status = 200;
    expect(await store.sync()).toBe(true);
    expect((await store.state()).dirty).toBe(false);
    expect(m.calls.at(-1)!.body).toEqual({ notifications: { enabled: false, newEdition: true, newEpisode: true } });
  });

  it("does not call the backend when nothing changed", async () => {
    const { store, m } = setup();
    expect(await store.sync()).toBe(true);
    expect(m.calls).toHaveLength(0);
  });

  it("survives a restart: a new store reads what the last one saved", async () => {
    const first = setup(() => 503);
    await first.store.set({ newEdition: false });
    const again = createPrefsStore({
      api: createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: mockFetch({}).fetch }),
      storage: first.storage,
    });
    expect(await again.state()).toMatchObject({ prefs: { newEdition: false }, dirty: true });
  });

  it("tells subscribers about each change", async () => {
    const { store } = setup();
    const seen: boolean[] = [];
    const off = store.subscribe((p) => seen.push(p.enabled));
    await store.set({ enabled: false });
    off();
    await store.set({ enabled: true });
    expect(seen).toEqual([false]);
  });

  it("rejects unknown switches and non-boolean values", async () => {
    const { store, m } = setup();
    await expect(store.set({ podcast: true } as any)).rejects.toThrow(/podcast/);
    await expect(store.set({ enabled: "yes" } as any)).rejects.toThrow(/enabled/);
    expect(m.calls).toHaveLength(0);
  });

  it("keeps a change made while a PUT is in flight marked dirty", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const m = mockFetch({
      "PUT /settings": async () => {
        if (++calls === 1) {
          await gate;
          return [200, {}];
        }
        return [503, { error: "down" }];
      },
    });
    const store = createPrefsStore({ api: createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch }), storage: memoryStore() });
    const first = store.set({ enabled: false });
    await new Promise((r) => setTimeout(r, 10));
    await store.set({ newEdition: false }); // its own PUT fails
    release();
    await first; // the older PUT succeeds last, but only carried the first change
    expect(await store.state()).toMatchObject({ dirty: true, prefs: { enabled: false, newEdition: false } });
  });

  it("ignores a corrupt saved value", async () => {
    const { store } = setup(undefined, { [PREFS_KEY]: "{not json" });
    expect(await store.get()).toEqual(DEFAULT_PREFS);
  });
});
