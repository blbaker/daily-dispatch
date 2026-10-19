// GET /notifications/since?ts=<ISO time | epoch ms>[&device=<id>][&limit=<1-100>]
// for desktop pollers. Returns notifications after `ts`, oldest first, and a
// cursor to send as `ts` next time.
import { getDevice } from "../devices";
import { HttpError, json } from "../http";
import { notificationsSince } from "../notifications";
import { allows } from "../push/fanout";
import { Route } from "../router";
import { NotificationPrefs, loadSettings } from "../settings";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseSince(ts: string | undefined): Date {
  let ms = NaN;
  if (ts && /^\d{1,16}$/.test(ts)) ms = Number(ts);
  else if (ts && ISO.test(ts)) ms = Date.parse(ts);
  if (Number.isNaN(ms)) throw new HttpError(400, "ts must be an ISO time or epoch milliseconds");
  return new Date(ms);
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new HttpError(400, "limit must be 1-100");
  return n;
}

export const notificationRoutes: Route[] = [
  {
    method: "GET",
    pattern: /^\/notifications\/since$/,
    run: async ({ deps, query }) => {
      const since = parseSince(query.ts);
      const limit = parseLimit(query.limit);
      let devicePrefs: NotificationPrefs | undefined;
      if (query.device) {
        const device = await getDevice(deps, query.device);
        if (!device) return json(404, { error: "unknown device; register it again with POST /devices" });
        devicePrefs = device.prefs;
      }
      const [settings, page] = await Promise.all([loadSettings(deps), notificationsSince(deps, since, limit)]);
      const notifications = page.items.filter((n) => allows(settings.notifications, devicePrefs, n.event));
      // Advance past filtered rows too, or a muted event would be re-read forever.
      const last = page.items[page.items.length - 1];
      const cursor = last ? last.createdAt : since.toISOString();
      return json(200, { notifications, cursor, ...(page.more ? { more: true } : {}) });
    },
  },
];
