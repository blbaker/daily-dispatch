// Web Push adapter: VAPID-signed, encrypted pushes through each browser's
// push service, using the web-push library. A 404 or 410 from the push
// service means the subscription is gone and the device row should be deleted.
import * as webpush from "web-push";
import { Device } from "../devices";
import { Log, PushProvider, emptyResult } from "./types";

export interface Vapid {
  publicKey?: string;
  privateKey?: string;
  /** mailto: or https: contact the push services can reach. */
  subject?: string;
}

export type WebPushSend = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions,
) => Promise<unknown>;

export interface WebPushOpts {
  vapid: Vapid;
  /** Defaults to webpush.sendNotification; tests pass a stub. */
  send?: WebPushSend;
  log: Log;
}

/** Push messages are kept by the push service for a day if the browser is offline. */
const TTL_SECONDS = 86400;

function validVapid(v: Vapid, log: Log): Required<Vapid> | null {
  const missing = (["publicKey", "privateKey", "subject"] as const).filter((k) => !v[k]);
  if (missing.length > 0) {
    log(`push: webpush provider disabled: missing VAPID ${missing.join(", ")} (see docs/push-setup.md)`);
    return null;
  }
  const full = v as Required<Vapid>;
  try {
    // Throws on malformed keys or subject; the global it sets is unused
    // because every send passes vapidDetails explicitly.
    webpush.setVapidDetails(full.subject, full.publicKey, full.privateKey);
  } catch (err) {
    log(`push: webpush provider disabled: invalid VAPID details (${err instanceof Error ? err.message : err})`);
    return null;
  }
  return full;
}

export function createWebPushProvider(o: WebPushOpts): PushProvider {
  const vapid = validVapid(o.vapid, o.log);
  const send: WebPushSend = o.send ?? webpush.sendNotification;
  return {
    kind: "webpush",
    enabled: vapid !== null,
    async send(devices: Device[], msg) {
      const result = emptyResult();
      if (vapid === null) return { ...result, skipped: devices.length };
      const payload = JSON.stringify(msg);
      const outcomes = await Promise.allSettled(
        devices.map((d) =>
          send(d.subscription as webpush.PushSubscription, payload, { vapidDetails: vapid, TTL: TTL_SECONDS }),
        ),
      );
      outcomes.forEach((r, i) => {
        if (r.status === "fulfilled") {
          result.sent += 1;
          return;
        }
        result.failed += 1;
        const status = (r.reason as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) result.invalid.push(devices[i].id);
        else o.log("push: webpush send failed", { deviceId: devices[i].id, status, error: String(r.reason) });
      });
      return result;
    },
  };
}
