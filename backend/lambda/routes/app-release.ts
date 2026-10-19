// GET /app/latest?variant=phone|eink -> newest APK + short-lived download URL.
import { json } from "../http";
import { presign } from "../presign";
import { Route } from "../router";

export const appReleaseRoutes: Route[] = [
  {
    method: "GET",
    pattern: /^\/app\/latest$/,
    run: async ({ deps, query }) => {
      const bucket = deps.env.releaseBucket;
      if (!bucket) return json(404, { error: "no release bucket" });
      const variant = query.variant === "eink" ? "eink" : "phone";
      const region = deps.env.region;
      const creds = deps.creds();
      const manifestUrl = presign({
        bucket, key: `releases/latest-${variant}.json`, region, creds, expires: 60,
      });
      const r = await deps.fetch(manifestUrl);
      if (r.status === 404 || r.status === 403) return json(404, { error: "no release yet" });
      if (!r.ok) return json(502, { error: `manifest HTTP ${r.status}` });
      const m = (await r.json()) as Record<string, unknown>;
      return json(200, {
        versionCode: Number(m.versionCode),
        versionName: m.versionName || String(m.versionCode),
        notes: m.notes || "",
        size: Number(m.size || 0),
        url: presign({ bucket, key: String(m.key), region, creds, expires: 3600 }),
      });
    },
  },
];
