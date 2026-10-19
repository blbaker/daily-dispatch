// Fake push providers that record what they were asked to send.
import { vi } from "vitest";
import { Device } from "../lambda/devices";
import { PushProviders } from "../lambda/push/registry";
import { PushMessage, SendResult, emptyResult } from "../lambda/push/types";

export interface FakeProvider {
  kind: "expo" | "webpush";
  enabled: boolean;
  sent: { devices: Device[]; msg: PushMessage }[];
  /** Device ids the fake reports as gone. */
  gone: Set<string>;
  send: (devices: Device[], msg: PushMessage) => Promise<SendResult>;
  checkReceipts: ReturnType<typeof vi.fn>;
}

export function fakeProvider(kind: "expo" | "webpush", enabled = true): FakeProvider {
  const p: FakeProvider = {
    kind,
    enabled,
    sent: [],
    gone: new Set(),
    send: async (devices, msg) => {
      if (!p.enabled) return { ...emptyResult(), skipped: devices.length };
      p.sent.push({ devices, msg });
      const r = emptyResult();
      for (const d of devices) {
        if (p.gone.has(d.id)) {
          r.failed += 1;
          r.invalid.push(d.id);
        } else {
          r.sent += 1;
          if (kind === "expo") r.tickets.push({ id: `ticket-${d.id}`, deviceId: d.id });
        }
      }
      return r;
    },
    checkReceipts: vi.fn(async () => ({ checked: [], unregistered: [] })),
  };
  return p;
}

export function fakeProviders(expo = fakeProvider("expo"), webpush = fakeProvider("webpush")) {
  const providers = { expo, webpush, vapidPublicKey: "BPUBLICKEY" } as unknown as PushProviders;
  return { expo, webpush, push: async () => providers };
}

const PREFS = { enabled: true, newEdition: true, newEpisode: true };
const T = "2026-10-01T00:00:00.000Z";

/** A stored DEVICE row as DynamoDB would return it. */
export function deviceRow(id: string, kind: "expo" | "webpush" | "poll", prefs: Partial<typeof PREFS> = {}) {
  const base = { pk: "DEVICE", sk: id, kind, prefs: { ...PREFS, ...prefs }, createdAt: T, updatedAt: T };
  if (kind === "expo") return { ...base, platform: "ios", token: `ExponentPushToken[${id}]` };
  if (kind === "webpush") {
    return { ...base, platform: "web", subscription: { endpoint: `https://push.example.test/${id}`, keys: { p256dh: "p", auth: "a" } } };
  }
  return { ...base, platform: "desktop", token: `install-${id}` };
}
