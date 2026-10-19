// GET /settings and PUT /settings (partial update, validated).
import { json, readJson } from "../http";
import { Route } from "../router";
import { loadSettings, mergeSettings, saveSettings } from "../settings";

export const settingsRoutes: Route[] = [
  {
    method: "GET",
    pattern: /^\/settings$/,
    run: async ({ deps }) => json(200, await loadSettings(deps)),
  },
  {
    method: "PUT",
    pattern: /^\/settings$/,
    run: async ({ deps, event }) => {
      const patch = readJson(event);
      const next = mergeSettings(await loadSettings(deps), patch, deps.now());
      await saveSettings(deps, next);
      return json(200, next);
    },
  },
];
