// Push helper routes.
//   POST /devices/<id>/test  -> send a test notification to one device
//   GET  /push/config        -> which providers are on, and the VAPID public
//                               key web clients need to subscribe
import { getDevice } from "../devices";
import { json } from "../http";
import { deliver } from "../push/fanout";
import { Route } from "../router";
import { DEVICE_ID } from "./devices";

export const pushRoutes: Route[] = [
  {
    method: "POST",
    pattern: new RegExp(`^/devices/${DEVICE_ID}/test$`),
    run: async ({ deps, params }) => {
      const device = await getDevice(deps, params[0]);
      if (!device) return json(404, { error: "unknown device" });
      if (device.kind === "poll") {
        return json(400, { error: "poll devices have no push channel; they read GET /notifications/since" });
      }
      const report = await deliver(deps, [device], {
        title: "Test notification",
        body: "Push works on this device.",
        data: { type: "test" },
      });
      return json(200, { ok: true, ...report });
    },
  },
  {
    method: "GET",
    pattern: /^\/push\/config$/,
    run: async ({ deps }) => {
      const p = await deps.push();
      return json(200, {
        expo: { enabled: p.expo.enabled },
        webpush: { enabled: p.webpush.enabled, vapidPublicKey: p.vapidPublicKey },
      });
    },
  },
];
