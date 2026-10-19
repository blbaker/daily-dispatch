// The push seam: one interface, one adapter per delivery service.
import { Device } from "../devices";

export interface PushMessage {
  title: string;
  body: string;
  /**
   * Handed to the app when the user taps the notification, for example
   * { type: "edition", id: "2026-10-19", path: "/editions/2026-10-19" }.
   */
  data: Record<string, string>;
}

export interface SendResult {
  sent: number;
  failed: number;
  /** Devices not attempted because the provider is disabled. */
  skipped: number;
  /** Device ids the push service reports as gone; the caller deletes them. */
  invalid: string[];
  /** Expo ticket ids to check for delivery receipts later. */
  tickets: { id: string; deviceId: string }[];
}

export interface PushProvider {
  readonly kind: "expo" | "webpush";
  /** False when credentials are absent or invalid; send() then skips. */
  readonly enabled: boolean;
  send(devices: Device[], msg: PushMessage): Promise<SendResult>;
}

export const emptyResult = (): SendResult => ({ sent: 0, failed: 0, skipped: 0, invalid: [], tickets: [] });

export function addResults(a: SendResult, b: SendResult): SendResult {
  return {
    sent: a.sent + b.sent,
    failed: a.failed + b.failed,
    skipped: a.skipped + b.skipped,
    invalid: [...a.invalid, ...b.invalid],
    tickets: [...a.tickets, ...b.tickets],
  };
}

export type Log = (message: string, detail?: unknown) => void;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
