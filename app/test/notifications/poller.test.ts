import { describe, expect, it, vi } from "vitest";
import { createPushApi } from "../../src/notifications/api";
import { CURSOR_KEY, POLL_MS, createPoller } from "../../src/notifications/poller";
import type { FeedNotification } from "../../src/notifications/types";
import { BASE, KEY, memoryStore, mockFetch } from "./helpers";

const NOW = Date.parse("2026-10-19T17:00:00.000Z");

function note(id: string, createdAt: string): FeedNotification {
  return { id, event: "edition", title: `Edition ${id}`, body: "3 stories", data: { type: "edition", id }, createdAt };
}

function setup(pages: Array<[number, unknown]>, seed: Record<string, string> = {}) {
  const m = mockFetch({ "GET /notifications/since": () => pages.shift() ?? [200, { notifications: [], cursor: "end" }] });
  const api = createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch });
  const storage = memoryStore(seed);
  const shown: string[] = [];
  let device = "dev-1";
  const reregister = vi.fn(async () => (device = "dev-2"));
  const timers = { setInterval: vi.fn(() => 7 as any), clearInterval: vi.fn() };
  const poller = createPoller({
    api,
    storage,
    timers,
    now: () => NOW,
    deviceId: () => device,
    reregister,
    show: async (n) => void shown.push(n.id),
  });
  const sent = () => m.calls.map((c) => new URL(c.url).searchParams);
  return { poller, storage, shown, reregister, timers, sent };
}

describe("desktop poller", () => {
  it("starts from now on the first run, so old notifications stay quiet", async () => {
    const { poller, storage, sent } = setup([[200, { notifications: [], cursor: "2026-10-19T17:00:00.000Z" }]]);
    await poller.pollOnce();
    expect(sent()[0].get("ts")).toBe("2026-10-19T17:00:00.000Z");
    expect(sent()[0].get("device")).toBe("dev-1");
    expect(storage.data.get(CURSOR_KEY)).toBe("2026-10-19T17:00:00.000Z");
  });

  it("shows each new notification in order and resumes from the returned cursor", async () => {
    const a = note("2026-10-19", "2026-10-19T17:01:00.000Z");
    const b = note("2026-10-20", "2026-10-19T17:02:00.000Z");
    const { poller, shown, storage, sent } = setup(
      [
        [200, { notifications: [a, b], cursor: b.createdAt }],
        [200, { notifications: [], cursor: b.createdAt }],
      ],
      { [CURSOR_KEY]: "2026-10-19T16:00:00.000Z" },
    );
    expect(await poller.pollOnce()).toBe(2);
    expect(shown).toEqual(["2026-10-19", "2026-10-20"]);
    expect(storage.data.get(CURSOR_KEY)).toBe(b.createdAt);
    await poller.pollOnce();
    expect(sent()[0].get("ts")).toBe("2026-10-19T16:00:00.000Z");
    expect(sent()[1].get("ts")).toBe(b.createdAt);
  });

  it("follows `more` pages in one poll", async () => {
    const a = note("a", "2026-10-19T17:01:00.000Z");
    const b = note("b", "2026-10-19T17:02:00.000Z");
    const { poller, shown, sent } = setup([
      [200, { notifications: [a], cursor: a.createdAt, more: true }],
      [200, { notifications: [b], cursor: b.createdAt }],
    ]);
    await poller.pollOnce();
    expect(shown).toEqual(["a", "b"]);
    expect(sent()[1].get("ts")).toBe(a.createdAt);
  });

  it("registers again when the backend forgot the device, then retries", async () => {
    const { poller, reregister, sent } = setup([
      [404, { error: "unknown device; register it again with POST /devices" }],
      [200, { notifications: [], cursor: "c" }],
    ]);
    await poller.pollOnce();
    expect(reregister).toHaveBeenCalledOnce();
    expect(sent().map((q) => q.get("device"))).toEqual(["dev-1", "dev-2"]);
  });

  it("keeps the cursor when a poll fails, so nothing is skipped", async () => {
    const { poller, storage, shown } = setup([[500, { error: "down" }]], { [CURSOR_KEY]: "c0" });
    expect(await poller.pollOnce()).toBe(0);
    expect(storage.data.get(CURSOR_KEY)).toBe("c0");
    expect(shown).toEqual([]);
  });

  it("polls at once on start, then every 5 minutes until stopped", async () => {
    const { poller, timers, sent } = setup([]);
    poller.start();
    await vi.waitFor(() => expect(sent()).toHaveLength(1));
    expect(POLL_MS).toBe(5 * 60 * 1000);
    expect(timers.setInterval).toHaveBeenCalledWith(expect.any(Function), POLL_MS);
    poller.stop();
    expect(timers.clearInterval).toHaveBeenCalledWith(7);
  });

  it("skips a tick while the previous poll is still running", async () => {
    const { poller, sent } = setup([]);
    await Promise.all([poller.pollOnce(), poller.pollOnce()]);
    expect(sent()).toHaveLength(1);
  });
});
