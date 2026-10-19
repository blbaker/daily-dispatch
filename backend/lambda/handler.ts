// Daily Dispatch API: one Lambda behind a Function URL.
//
// Auth: every request except GET /health must carry the API key, either as
// the `x-api-key` header or the `?key=` query parameter. Compared in constant
// time. The deployment has a single user.
import { Deps, defaultDeps } from "./deps";
import { HttpError, HttpEvent, HttpResult, extractKey, json, keyMatches, methodAndPath, query } from "./http";
import { Route, matchRoute } from "./router";
import { appReleaseRoutes } from "./routes/app-release";
import { deviceRoutes } from "./routes/devices";
import { editionRoutes } from "./routes/editions";
import { settingsRoutes } from "./routes/settings";

export const ROUTES: Route[] = [...editionRoutes, ...appReleaseRoutes, ...settingsRoutes, ...deviceRoutes];

const PLACEHOLDER_KEY = "PLACEHOLDER_SET_AT_DEPLOY";

export function createHandler(deps: Deps) {
  return async (event: HttpEvent): Promise<HttpResult> => {
    const { method, path } = methodAndPath(event);
    if (method === "GET" && path === "/health") return json(200, { ok: true });

    if (!deps.env.apiKey || deps.env.apiKey === PLACEHOLDER_KEY) {
      return json(500, { error: "API key not configured" });
    }
    if (!keyMatches(extractKey(event), deps.env.apiKey)) {
      return json(401, { error: "unauthorized" });
    }

    const hit = matchRoute(ROUTES, method, path);
    if (!hit) return json(404, { error: "no route", method, path });
    try {
      return await hit.route.run({ deps, event, query: query(event), params: hit.params });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error("handler error", err);
      return json(500, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

let live: ReturnType<typeof createHandler> | undefined;

export const handler = (event: HttpEvent): Promise<HttpResult> => {
  live ??= createHandler(defaultDeps());
  return live(event);
};
