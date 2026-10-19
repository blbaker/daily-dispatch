import { describe, expect, it, vi } from "vitest";
import { createPushApi } from "../../src/notifications/api";
import type { AdapterEvents } from "../../src/notifications/types";
import { base64UrlToBytes, createWebAdapter, type WebEnv } from "../../src/notifications/webAdapter";
import { BASE, KEY, mockFetch } from "./helpers";

// A real P-256 public key is 65 bytes; any 65 bytes do for these tests.
const VAPID = Buffer.from(Array.from({ length: 65 }, (_, i) => i)).toString("base64url");
const OTHER = Buffer.from(Array.from({ length: 65 }, (_, i) => 64 - i)).toString("base64url");

function fakeSub(key: string) {
  return {
    endpoint: "https://push.example/sub/1",
    options: { applicationServerKey: base64UrlToBytes(key).buffer },
    unsubscribe: vi.fn(async () => true),
    toJSON: () => ({ endpoint: "https://push.example/sub/1", keys: { p256dh: "p".repeat(20), auth: "a".repeat(16) } }),
  };
}

function setup(over: { permission?: string; existing?: ReturnType<typeof fakeSub> | null; vapid?: string | null; search?: string } = {}) {
  const handlers: Record<string, (e: any) => void> = {};
  const pushManager = {
    getSubscription: vi.fn(async () => over.existing ?? null),
    subscribe: vi.fn(async (_opts: any) => fakeSub(VAPID)),
  };
  const registration = { pushManager };
  const env: WebEnv = {
    serviceWorker: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      addEventListener: (t: string, fn: (e: any) => void) => void (handlers[t] = fn),
      removeEventListener: (t: string) => void delete handlers[t],
    },
    Notification: {
      permission: over.permission ?? "granted",
      requestPermission: vi.fn(async () => "granted"),
    },
    hasPushManager: true,
    location: { search: over.search ?? "", pathname: "/" },
    history: { replaceState: vi.fn() },
  };
  const vapidPublicKey = over.vapid === undefined ? VAPID : over.vapid;
  const m = mockFetch({ "GET /push/config": () => [200, { expo: { enabled: false }, webpush: { enabled: !!vapidPublicKey, vapidPublicKey } }] });
  const adapter = createWebAdapter({ env, api: createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch }) });
  return { adapter, env, pushManager, handlers };
}

describe("web adapter", () => {
  it("reports unsupported without a service worker or PushManager", async () => {
    const { adapter, env } = setup();
    env.hasPushManager = false;
    expect(await adapter.permission(true)).toBe("unsupported");
  });

  it("asks for permission only when prompting", async () => {
    const { adapter, env } = setup({ permission: "default" });
    expect(await adapter.permission(false)).toBe("prompt");
    expect(env.Notification!.requestPermission).not.toHaveBeenCalled();
    expect(await adapter.permission(true)).toBe("granted");
    expect((await setup({ permission: "denied" }).adapter.permission(true))).toBe("denied");
  });

  it("registers the service worker and subscribes with the server's VAPID key", async () => {
    const { adapter, env, pushManager } = setup();
    const cred = (await adapter.credential()) as { subscription: any };
    expect(env.serviceWorker!.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    const opts = pushManager.subscribe.mock.calls[0][0];
    expect(opts.userVisibleOnly).toBe(true);
    expect(Array.from(opts.applicationServerKey as Uint8Array)).toEqual(Array.from(base64UrlToBytes(VAPID)));
    expect(cred.subscription.endpoint).toBe("https://push.example/sub/1");
  });

  it("reuses a subscription made with the same key, and replaces one made with another", async () => {
    const same = setup({ existing: fakeSub(VAPID) });
    await same.adapter.credential();
    expect(same.pushManager.subscribe).not.toHaveBeenCalled();
    const stale = fakeSub(OTHER);
    const other = setup({ existing: stale });
    await other.adapter.credential();
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(other.pushManager.subscribe).toHaveBeenCalled();
  });

  it("explains when the server has Web Push turned off", async () => {
    await expect(setup({ vapid: null }).adapter.credential()).rejects.toThrow(/VAPID/);
  });

  it("opens the target in the URL once, then clears it from the address bar", () => {
    const { adapter, env } = setup({ search: "?edition=2026-10-19" });
    const ev: AdapterEvents = { open: vi.fn(), receive: vi.fn() };
    adapter.listen!(ev);
    expect(ev.open).toHaveBeenCalledWith({ kind: "edition", id: "2026-10-19" });
    expect(env.history!.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("turns service worker messages into open and receive events", () => {
    const { adapter, handlers } = setup();
    const ev: AdapterEvents = { open: vi.fn(), receive: vi.fn() };
    const off = adapter.listen!(ev);
    handlers.message({ data: { type: "dd-open", data: { type: "episode", id: "ep-1" } } });
    handlers.message({ data: { type: "dd-push", data: { type: "edition", id: "2026-10-19" } } });
    handlers.message({ data: "unrelated" });
    expect(ev.open).toHaveBeenCalledWith({ kind: "episode", id: "ep-1" });
    expect(ev.receive).toHaveBeenCalledWith({ type: "edition", id: "2026-10-19" });
    off();
    expect(handlers.message).toBeUndefined();
  });
});
