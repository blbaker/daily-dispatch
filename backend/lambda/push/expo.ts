// Expo push service adapter (iOS and Android, including the e-ink build).
//
// Contract, checked against the live API before this was written:
//   POST /push/send         body: up to 100 messages; reply { data: ticket[] }
//                           in message order. A ticket is { status: "ok", id }
//                           or { status: "error", details: { error } }.
//   POST /push/getReceipts  body: { ids } up to 1000; reply { data: { [id]: receipt } }.
//                           Ids whose receipt is not ready are simply absent.
// DeviceNotRegistered, in a ticket or a receipt, means the token is dead and
// the device row should be deleted.
//
// The access token is required: with Expo's enhanced push security on, only a
// holder of the token can push to the app's devices. No token, no provider.
import { Device } from "../devices";
import { Log, PushMessage, PushProvider, SendResult, addResults, chunk, emptyResult } from "./types";

export const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const SEND_BATCH = 100;
const RECEIPT_BATCH = 1000;

interface Ticket {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ReceiptCheck {
  /** Ticket ids that had a receipt (ok or error); safe to forget. */
  checked: string[];
  /** Ticket ids whose receipt says DeviceNotRegistered. */
  unregistered: string[];
}

export interface ExpoProvider extends PushProvider {
  checkReceipts(ticketIds: string[]): Promise<ReceiptCheck>;
}

export interface ExpoOpts {
  accessToken?: string;
  fetch: typeof fetch;
  log: Log;
}

export function createExpoProvider(o: ExpoOpts): ExpoProvider {
  const enabled = !!o.accessToken;
  if (!enabled) {
    o.log("push: expo provider disabled: no EXPO_ACCESS_TOKEN (set it or EXPO_ACCESS_TOKEN_PARAM)");
  }
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${o.accessToken ?? ""}`,
  };

  async function post(url: string, body: unknown): Promise<unknown> {
    const r = await o.fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function sendBatch(batch: Device[], msg: PushMessage): Promise<SendResult> {
    const result = emptyResult();
    const messages = batch.map((d) => ({ to: d.token, title: msg.title, body: msg.body, data: msg.data, sound: "default" }));
    let tickets: Ticket[];
    try {
      const reply = (await post(EXPO_SEND_URL, messages)) as { data?: Ticket[] };
      if (!Array.isArray(reply.data) || reply.data.length !== batch.length) throw new Error("ticket count mismatch");
      tickets = reply.data;
    } catch (err) {
      o.log("push: expo send failed", String(err));
      result.failed = batch.length;
      return result;
    }
    tickets.forEach((t, i) => {
      const deviceId = batch[i].id;
      if (t.status === "ok" && t.id) {
        result.sent += 1;
        result.tickets.push({ id: t.id, deviceId });
        return;
      }
      result.failed += 1;
      if (t.details?.error === "DeviceNotRegistered") result.invalid.push(deviceId);
      else o.log("push: expo ticket error", { deviceId, error: t.details?.error, message: t.message });
    });
    return result;
  }

  return {
    kind: "expo",
    enabled,
    async send(devices, msg) {
      if (!enabled) return { ...emptyResult(), skipped: devices.length };
      const results = await Promise.all(chunk(devices, SEND_BATCH).map((b) => sendBatch(b, msg)));
      return results.reduce(addResults, emptyResult());
    },
    async checkReceipts(ids) {
      const out: ReceiptCheck = { checked: [], unregistered: [] };
      if (!enabled) return out;
      for (const batch of chunk(ids, RECEIPT_BATCH)) {
        let data: Record<string, Ticket>;
        try {
          data = ((await post(EXPO_RECEIPTS_URL, { ids: batch })) as { data?: Record<string, Ticket> }).data ?? {};
        } catch (err) {
          o.log("push: expo receipt check failed", String(err));
          continue;
        }
        for (const id of batch) {
          const receipt = data[id];
          if (!receipt) continue; // not ready yet
          out.checked.push(id);
          if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered") out.unregistered.push(id);
        }
      }
      return out;
    },
  };
}
