// Fan-out: record a notification once, then push it to every device whose
// prefs allow the event. Desktop pollers ("poll" devices) are not pushed to;
// they read the notification log through GET /notifications/since.
import { Deps } from "../deps";
import { DEFAULT_DEVICE_PREFS, Device, deleteDevice, listDevices } from "../devices";
import { NotificationEvent, claimNotification, recordNotification } from "../notifications";
import { NotificationPrefs, loadSettings } from "../settings";
import { storeTickets } from "./receipts";
import { PushMessage, addResults, emptyResult } from "./types";

const EVENT_PREF: Record<NotificationEvent, "newEdition" | "newEpisode"> = {
  edition: "newEdition",
  episode: "newEpisode",
};

/** Global settings and the device's own prefs must both allow the event. */
export function allows(global: NotificationPrefs, device: NotificationPrefs | undefined, event: NotificationEvent): boolean {
  const pref = EVENT_PREF[event];
  const d = { ...DEFAULT_DEVICE_PREFS, ...(device ?? {}) };
  return global.enabled && global[pref] && d.enabled && d[pref];
}

export interface DeliveryReport {
  sent: number;
  failed: number;
  skipped: number;
  /** Devices deleted because their push service said they are gone. */
  pruned: number;
}

/** Sends to each device through its provider, deletes dead devices, keeps Expo tickets. */
export async function deliver(deps: Deps, devices: Device[], msg: PushMessage): Promise<DeliveryReport> {
  const providers = await deps.push();
  const expo = devices.filter((d) => d.kind === "expo");
  const web = devices.filter((d) => d.kind === "webpush");
  const [a, b] = await Promise.all([
    expo.length > 0 ? providers.expo.send(expo, msg) : emptyResult(),
    web.length > 0 ? providers.webpush.send(web, msg) : emptyResult(),
  ]);
  const r = addResults(a, b);
  for (const id of r.invalid) await deleteDevice(deps, id);
  await storeTickets(deps, r.tickets);
  return { sent: r.sent, failed: r.failed, skipped: r.skipped, pruned: r.invalid.length };
}

export interface PublishInput {
  event: NotificationEvent;
  refId: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PublishReport =
  | { recorded: false; reason: string }
  | { recorded: false; error: string }
  | ({ recorded: true; id: string; error?: string } & Partial<DeliveryReport>);

/**
 * Records the notification and fans it out. Never throws: the caller has
 * already stored the edition or episode, and a push failure must not turn
 * that into an error response.
 */
export async function publish(deps: Deps, input: PublishInput): Promise<PublishReport> {
  const id = `${input.event}#${input.refId}`;
  try {
    if (!(await claimNotification(deps, input.event, input.refId))) {
      return { recorded: false, reason: "already-notified" };
    }
    await recordNotification(deps, { id, ...input, createdAt: deps.now().toISOString() });
  } catch (err) {
    deps.log("push: could not record notification", { id, error: String(err) });
    return { recorded: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const [settings, devices] = await Promise.all([loadSettings(deps), listDevices(deps)]);
    const targets = devices.filter((d) => allows(settings.notifications, d.prefs, input.event));
    const report = await deliver(deps, targets, { title: input.title, body: input.body, data: input.data });
    deps.log("push: fan-out done", { id, ...report });
    return { recorded: true, id, ...report };
  } catch (err) {
    deps.log("push: fan-out failed", { id, error: String(err) });
    return { recorded: true, id, error: err instanceof Error ? err.message : String(err) };
  }
}
