import * as crypto from "crypto";
import { describe, expect, it, vi } from "vitest";
import * as webpush from "web-push";
import { Device } from "../lambda/devices";
import { EXPO_RECEIPTS_URL, EXPO_SEND_URL, createExpoProvider } from "../lambda/push/expo";
import { createWebPushProvider } from "../lambda/push/webpush";

const MSG = { title: "New edition", body: "12 stories", data: { type: "edition", id: "2026-10-19" } };
const PREFS = { enabled: true, newEdition: true, newEpisode: true };
const T = "2026-10-19T22:00:00.000Z";

function expoDevice(i: number): Device {
  return { id: `dev${i}`, platform: "android", kind: "expo", token: `ExponentPushToken[t${i}]`, prefs: PREFS, createdAt: T, updatedAt: T };
}

const SUB = { endpoint: "https://push.example.test/a", keys: { p256dh: "p256dh-key", auth: "auth-key" } };
function webDevice(id: string): Device {
  return { id, platform: "web", kind: "webpush", subscription: { ...SUB, endpoint: `${SUB.endpoint}/${id}` }, prefs: PREFS, createdAt: T, updatedAt: T };
}

/** A fetch stub that answers each Expo send with one ticket per message. */
function expoFetch(ticketFor: (to: string) => object) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const msgs = JSON.parse(String(init?.body)) as { to: string }[];
    return new Response(JSON.stringify({ data: msgs.map((m) => ticketFor(m.to)) }), { status: 200 });
  });
}

describe("expo provider", () => {
  it("is disabled without an access token, logs why, and never calls the network", async () => {
    const fetch = vi.fn();
    const log = vi.fn();
    const p = createExpoProvider({ accessToken: undefined, fetch: fetch as never, log });
    expect(p.enabled).toBe(false);
    expect(log.mock.calls[0][0]).toMatch(/expo.*disabled/i);
    expect(await p.send([expoDevice(1)], MSG)).toEqual({ sent: 0, failed: 0, skipped: 1, invalid: [], tickets: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends in batches of 100 with the bearer token and maps tickets to devices", async () => {
    const fetch = expoFetch((to) => ({ status: "ok", id: `ticket-${to}` }));
    const p = createExpoProvider({ accessToken: "expo-token", fetch: fetch as never, log: vi.fn() });
    const devices = Array.from({ length: 250 }, (_, i) => expoDevice(i));
    const r = await p.send(devices, MSG);
    expect(fetch.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).length)).toEqual([100, 100, 50]);
    expect(fetch.mock.calls[0][0]).toBe(EXPO_SEND_URL);
    expect((fetch.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe("Bearer expo-token");
    const first = JSON.parse(String(fetch.mock.calls[0][1]?.body))[0];
    expect(first).toMatchObject({ to: "ExponentPushToken[t0]", title: "New edition", body: "12 stories", data: MSG.data });
    expect(r.sent).toBe(250);
    expect(r.tickets[0]).toEqual({ id: "ticket-ExponentPushToken[t0]", deviceId: "dev0" });
  });

  it("marks DeviceNotRegistered tickets invalid and counts other errors as failed", async () => {
    const fetch = expoFetch((to) =>
      to.includes("t1]")
        ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
        : to.includes("t2]")
          ? { status: "error", message: "slow down", details: { error: "MessageRateExceeded" } }
          : { status: "ok", id: "ok-ticket" },
    );
    const p = createExpoProvider({ accessToken: "x", fetch: fetch as never, log: vi.fn() });
    const r = await p.send([expoDevice(0), expoDevice(1), expoDevice(2)], MSG);
    expect(r).toMatchObject({ sent: 1, failed: 2, invalid: ["dev1"] });
  });

  it("counts a whole failed batch without throwing", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 503 }));
    const log = vi.fn();
    const p = createExpoProvider({ accessToken: "x", fetch: fetch as never, log });
    expect(await p.send([expoDevice(0), expoDevice(1)], MSG)).toMatchObject({ sent: 0, failed: 2 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/expo send failed/i), expect.anything());
  });

  it("checks receipts in batches of 1000 and reports unregistered tickets", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `r${i}`);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const asked = JSON.parse(String(init?.body)).ids as string[];
      const data: Record<string, object> = {};
      for (const id of asked) {
        if (id === "r5") continue; // receipt not ready yet
        data[id] = id === "r7" ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" };
      }
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const p = createExpoProvider({ accessToken: "x", fetch: fetch as never, log: vi.fn() });
    const r = await p.checkReceipts(ids);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([EXPO_RECEIPTS_URL, EXPO_RECEIPTS_URL]);
    expect(fetch.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).ids.length)).toEqual([1000, 1]);
    expect(r.unregistered).toEqual(["r7"]);
    expect(r.checked).toHaveLength(1000);
    expect(r.checked).not.toContain("r5");
  });
});

describe("webpush provider", () => {
  const vapid = { ...webpush.generateVAPIDKeys(), subject: "mailto:ops@example.test" };

  it.each(["publicKey", "privateKey", "subject"] as const)("is disabled and logs when %s is missing", (field) => {
    const log = vi.fn();
    const p = createWebPushProvider({ vapid: { ...vapid, [field]: undefined }, log });
    expect(p.enabled).toBe(false);
    expect(log.mock.calls[0][0]).toMatch(/webpush.*disabled/i);
  });

  it("is disabled and logs when the keys are malformed", () => {
    const log = vi.fn();
    const p = createWebPushProvider({ vapid: { ...vapid, publicKey: "abc" }, log });
    expect(p.enabled).toBe(false);
    expect(log.mock.calls[0][0]).toMatch(/webpush.*disabled/i);
  });

  it("hands the real web-push library arguments it accepts: an encrypted, VAPID-signed request", async () => {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
    let details: ReturnType<typeof webpush.generateRequestDetails> | undefined;
    const send = vi.fn(async (sub: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => {
      details = webpush.generateRequestDetails(sub, payload, options);
      return { statusCode: 201 };
    });
    const p = createWebPushProvider({ vapid, send, log: vi.fn() });
    const device = { ...webDevice("real"), subscription: { endpoint: "https://push.example.test/real", keys } };
    expect(await p.send([device], MSG)).toMatchObject({ sent: 1, failed: 0 });
    expect(details?.endpoint).toBe("https://push.example.test/real");
    expect(details?.headers).toMatchObject({ TTL: 86400, "Content-Encoding": "aes128gcm" });
    expect(String(details?.headers.Authorization)).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));
    expect(details?.body?.length).toBeGreaterThan(JSON.stringify(MSG).length);
  });

  it("sends the message as JSON with the VAPID details and prunes gone subscriptions", async () => {
    const send = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("/missing")) throw Object.assign(new Error("Not found"), { statusCode: 404 });
      if (sub.endpoint.endsWith("/flaky")) throw Object.assign(new Error("Server"), { statusCode: 500 });
      return { statusCode: 201 };
    });
    const p = createWebPushProvider({ vapid, send, log: vi.fn() });
    expect(p.enabled).toBe(true);
    const r = await p.send([webDevice("ok"), webDevice("gone"), webDevice("missing"), webDevice("flaky")], MSG);
    expect(r).toMatchObject({ sent: 1, failed: 3, invalid: ["gone", "missing"] });
    const [sub, payload, options] = send.mock.calls[0] as unknown as [object, string, webpush.RequestOptions];
    expect(sub).toMatchObject({ endpoint: `${SUB.endpoint}/ok`, keys: SUB.keys });
    expect(JSON.parse(payload)).toEqual(MSG);
    expect(options.vapidDetails).toEqual(vapid);
    expect(options.TTL).toBe(86400);
  });
});
