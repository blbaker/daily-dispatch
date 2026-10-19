// POST /devices (register or update) and DELETE /devices/<id>.
import { DEFAULT_DEVICE_PREFS, checkPrefs, deleteDevice, getDevice, parseRegistration, publicDevice, putDevice } from "../devices";
import { json, readJson } from "../http";
import { Route } from "../router";

export const DEVICE_ID = "([0-9a-f]{24})";

export const deviceRoutes: Route[] = [
  {
    method: "POST",
    pattern: /^\/devices$/,
    run: async ({ deps, event }) => {
      const body = readJson(event);
      const reg = parseRegistration(body);
      const existing = await getDevice(deps, reg.id);
      const prefs = checkPrefs(body.prefs, existing?.prefs ?? DEFAULT_DEVICE_PREFS);
      const now = deps.now().toISOString();
      const device = {
        ...reg,
        name: reg.name ?? existing?.name,
        prefs,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await putDevice(deps, device);
      return json(200, { device: publicDevice(device) });
    },
  },
  {
    method: "DELETE",
    pattern: new RegExp(`^/devices/${DEVICE_ID}$`),
    run: async ({ deps, params }) => json(200, { ok: true, removed: await deleteDevice(deps, params[0]) }),
  },
];
