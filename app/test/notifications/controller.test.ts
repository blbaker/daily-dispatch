import { describe, expect, it, vi } from "vitest";
import { createPushApi } from "../../src/notifications/api";
import { createNotifications } from "../../src/notifications/controller";
import type { AdapterEvents, Channel, Permission, PushAdapter } from "../../src/notifications/types";
import { BASE, KEY, memoryStore, mockFetch } from "./helpers";

const DEVICE = "0123456789abcdef01234567";

function fakeAdapter(channel: Channel, over: Partial<PushAdapter> & { perm?: Permission } = {}) {
  const platform = channel === "expo" ? "android" : channel === "webpush" ? "web" : "desktop";
  let events: AdapterEvents | null = null;
  const adapter = {
    channel,
    platform,
    permission: vi.fn(async (prompt: boolean) => over.perm ?? (prompt ? "granted" : "granted")),
    credential: vi.fn(async () =>
      channel === "webpush"
        ? { subscription: { endpoint: "https://push.example/sub/1", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } } }
        : { token: channel === "expo" ? "ExponentPushToken[abc]" : "install-id-123" },
    ),
    listen: vi.fn((ev: AdapterEvents) => {
      events = ev;
      return () => (events = null);
    }),
    ...over,
  } as PushAdapter;
  return { adapter, emit: () => events };
}

function setup(os: string, adapterOver: Partial<PushAdapter> & { perm?: Permission } = {}, status = 200) {
  const m = mockFetch({
    "POST /devices": () => (status === 200 ? [200, { device: { id: DEVICE } }] : [status, { error: "boom" }]),
    "GET /notifications/since": () => [200, { notifications: [], cursor: "2026-10-19T00:00:00.000Z" }],
  });
  const api = createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch });
  const made: Channel[] = [];
  const fakes: Record<Channel, ReturnType<typeof fakeAdapter>> = {
    expo: fakeAdapter("expo", adapterOver),
    webpush: fakeAdapter("webpush", adapterOver),
    poll: fakeAdapter("poll", adapterOver),
  };
  const adapters = Object.fromEntries(
    (Object.keys(fakes) as Channel[]).map((c) => [c, () => (made.push(c), fakes[c].adapter)]),
  ) as Record<Channel, () => PushAdapter>;
  const storage = memoryStore();
  const timers = { setInterval: vi.fn(() => 1 as any), clearInterval: vi.fn() };
  const n = createNotifications({ os, adapters, api, storage, timers });
  return { n, m, made, fakes, storage, timers };
}

describe("platform selection", () => {
  it.each([
    ["android", "expo"],
    ["ios", "expo"],
    ["web", "webpush"],
    ["impeller", "poll"],
  ])("on %s builds only the %s adapter", async (os, channel) => {
    const { n, made } = setup(os);
    await n.start();
    expect(n.channel).toBe(channel);
    expect(made).toEqual([channel]);
  });
});

describe("registration flow", () => {
  it("registers an Expo token on Android and remembers the device id", async () => {
    const { n, m, storage } = setup("android");
    const st = await n.start();
    expect(st).toEqual({ channel: "expo", state: "registered", deviceId: DEVICE });
    const post = m.calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ platform: "android", kind: "expo", token: "ExponentPushToken[abc]" });
    expect(post.headers["x-api-key"]).toBe(KEY);
    expect(storage.data.get("dd.push.deviceId")).toBe(DEVICE);
  });

  it("registers a Web Push subscription in the browser", async () => {
    const { n, m } = setup("web");
    await n.start();
    const post = m.calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ platform: "web", kind: "webpush", subscription: { endpoint: "https://push.example/sub/1" } });
  });

  it("registers a desktop install id as a poll device", async () => {
    const { n, m } = setup("impeller");
    await n.start();
    expect(m.calls.find((c) => c.method === "POST")!.body).toEqual({ platform: "desktop", kind: "poll", token: "install-id-123" });
  });

  it("does not ask or register when the user has not been asked and prompt is off", async () => {
    const { n, m, fakes } = setup("web", { perm: "prompt" });
    const st = await n.start({ prompt: false });
    expect(st.state).toBe("needs-permission");
    expect(fakes.webpush.adapter.permission).toHaveBeenCalledWith(false);
    expect(fakes.webpush.adapter.credential).not.toHaveBeenCalled();
    expect(m.calls).toHaveLength(0);
  });

  it("enable() asks for permission", async () => {
    const { n, fakes } = setup("android");
    await n.enable();
    expect(fakes.expo.adapter.permission).toHaveBeenCalledWith(true);
    expect(n.status().state).toBe("registered");
  });

  it("stops at denied and unsupported", async () => {
    expect((await setup("android", { perm: "denied" }).n.start()).state).toBe("denied");
    expect((await setup("web", { perm: "unsupported" }).n.start()).state).toBe("unsupported");
  });

  it("reports a failed credential or registration as an error with the reason", async () => {
    const failing = setup("android", { credential: async () => Promise.reject(new Error("no EAS project id")) });
    expect(await failing.n.start()).toMatchObject({ state: "error", detail: "no EAS project id" });
    const rejected = setup("android", {}, 500);
    expect(await rejected.n.start()).toMatchObject({ state: "error", detail: "register failed: boom" });
  });

  it("does nothing on the network when the API is not configured", async () => {
    const storage = memoryStore();
    const adapter = fakeAdapter("expo").adapter;
    const n = createNotifications({
      os: "android",
      adapters: { expo: () => adapter, webpush: () => adapter, poll: () => adapter },
      api: createPushApi({ baseUrl: "", apiKey: "" }),
      storage,
    });
    expect(await n.start()).toMatchObject({ state: "error", detail: "API not configured" });
    expect(adapter.permission).not.toHaveBeenCalled();
  });

  it("tells status listeners about each change", async () => {
    const { n } = setup("android");
    const seen: string[] = [];
    n.onStatus((s) => seen.push(s.state));
    await n.start();
    expect(seen).toEqual(["registered"]);
  });
});

describe("events", () => {
  it("polls after a desktop registers and banners what the OS could not show", async () => {
    const note = { id: "n1", event: "edition", title: "Edition ready", body: "3 stories", data: { type: "edition", id: "2026-10-19" }, createdAt: "2026-10-19T17:01:00.000Z" };
    const shownNatively: string[] = [];
    const m = mockFetch({
      "POST /devices": () => [200, { device: { id: DEVICE } }],
      "GET /notifications/since": () => [200, { notifications: [note, { ...note, id: "n2" }], cursor: note.createdAt }],
    });
    const adapter = fakeAdapter("poll", {
      show: async (n) => (shownNatively.push(n.id), n.id === "n1"),
    }).adapter;
    const n = createNotifications({
      os: "impeller",
      adapters: { expo: () => adapter, webpush: () => adapter, poll: () => adapter },
      api: createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch }),
      storage: memoryStore(),
      timers: { setInterval: () => 1, clearInterval: () => {} },
    });
    const banners: string[] = [];
    n.onBanner((b) => banners.push(b.id));
    await n.start();
    await vi.waitFor(() => expect(shownNatively).toEqual(["n1", "n2"]));
    expect(banners).toEqual(["n2"]);
    expect(new URL(m.calls[1].url).searchParams.get("device")).toBe(DEVICE);
  });

  it("does not poll on Expo or Web Push", async () => {
    const { n, m, timers } = setup("android");
    await n.start();
    expect(timers.setInterval).not.toHaveBeenCalled();
    expect(m.calls.some((c) => c.url.includes("/notifications/since"))).toBe(false);
  });

  it("passes taps to open listeners, holding one that arrives before anyone listens", async () => {
    const { n, fakes } = setup("android");
    await n.start();
    fakes.expo.emit()!.open({ kind: "edition", id: "2026-10-19" });
    const opened: string[] = [];
    n.onOpen((t) => opened.push(`${t.kind}:${t.id}`));
    fakes.expo.emit()!.open({ kind: "episode", id: "ep-1" });
    expect(opened).toEqual(["edition:2026-10-19", "episode:ep-1"]);
  });

  it("passes foreground deliveries to receive listeners", async () => {
    const { n, fakes } = setup("web");
    const got: unknown[] = [];
    n.onReceive((d) => got.push(d));
    await n.start();
    fakes.webpush.emit()!.receive({ type: "edition", id: "2026-10-19" });
    expect(got).toEqual([{ type: "edition", id: "2026-10-19" }]);
  });
});
