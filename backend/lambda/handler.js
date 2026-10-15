"use strict";
/**
 * Daily Digest API — single Lambda behind a Function URL.
 *
 * Auth: every request must carry the API key, either as header `x-api-key`
 * or query param `?key=`. Compared in constant time. Baker is the only user.
 *
 * Routes (method + path in the Function URL event):
 *   GET  /editions            -> list edition metadata, newest first
 *   GET  /editions/<date>     -> one edition with all its stories
 *   POST /editions            -> upsert an edition + stories (the 5PM job)
 *   GET  /health              -> ok (no auth) for a cheap liveness check
 */
const crypto = require("crypto");
const {
  DynamoDBClient,
} = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME;
const GSI = process.env.GSI_NAME || "byType";
const API_KEY = process.env.API_KEY || "";
const RELEASE_BUCKET = process.env.RELEASE_BUCKET || "";
const { presignGet, lambdaCreds } = require("./presign");

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getMethodAndPath(event) {
  // Function URL event (payload format 2.0)
  const method = event.requestContext?.http?.method || "GET";
  let path = event.rawPath || "/";
  // strip a trailing slash except root
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { method, path };
}

function extractKey(event) {
  const h = event.headers || {};
  const headerKey = h["x-api-key"] || h["X-Api-Key"];
  if (headerKey) return headerKey;
  const q = event.queryStringParameters || {};
  return q.key || q.apiKey || "";
}

exports.handler = async (event) => {
  const { method, path } = getMethodAndPath(event);

  if (method === "GET" && path === "/health") return json(200, { ok: true });

  // ---- auth gate ----
  if (!API_KEY || API_KEY === "PLACEHOLDER_SET_AT_DEPLOY") {
    return json(500, { error: "API key not configured" });
  }
  if (!timingSafeEqual(extractKey(event), API_KEY)) {
    return json(401, { error: "unauthorized" });
  }

  try {
    // GET /app/latest?variant=phone|eink -> newest APK + short-lived download URL
    if (method === "GET" && path === "/app/latest") {
      if (!RELEASE_BUCKET) return json(404, { error: "no release bucket" });
      const q = event.queryStringParameters || {};
      const variant = q.variant === "eink" ? "eink" : "phone";
      const region = process.env.AWS_REGION;
      const creds = lambdaCreds();
      const manifestUrl = presignGet({
        bucket: RELEASE_BUCKET, key: `releases/latest-${variant}.json`,
        region, creds, expires: 60,
      });
      const r = await fetch(manifestUrl);
      if (r.status === 404 || r.status === 403) return json(404, { error: "no release yet" });
      if (!r.ok) return json(502, { error: `manifest HTTP ${r.status}` });
      const m = await r.json();
      return json(200, {
        versionCode: Number(m.versionCode),
        versionName: m.versionName || String(m.versionCode),
        notes: m.notes || "",
        size: Number(m.size || 0),
        url: presignGet({ bucket: RELEASE_BUCKET, key: m.key, region, creds, expires: 3600 }),
      });
    }

    // GET /editions  -> list newest first
    if (method === "GET" && path === "/editions") {
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: GSI,
          KeyConditionExpression: "itemType = :t",
          ExpressionAttributeValues: { ":t": "EDITION" },
          ScanIndexForward: false, // newest first
        })
      );
      const editions = (res.Items || []).map((it) => ({
        id: it.date,
        date: it.dateLabel,
        weekday: it.weekday,
        full: it.full,
        count: it.count,
        lead: it.lead,
        hero: it.hero || "",
        inProgress: !!it.inProgress,
      }));
      return json(200, { editions });
    }

    // GET /editions/<date>  -> edition + stories
    const m = path.match(/^\/editions\/(\d{4}-\d{2}-\d{2})$/);
    if (method === "GET" && m) {
      const date = m[1];
      const res = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "pk = :p",
          ExpressionAttributeValues: { ":p": `EDITION#${date}` },
        })
      );
      const items = res.Items || [];
      const meta = items.find((i) => i.sk === "META");
      if (!meta) return json(404, { error: "not found" });
      const stories = items
        .filter((i) => i.sk.startsWith("STORY#"))
        .sort((a, b) => a.sk.localeCompare(b.sk))
        .map((s) => ({
          cat: s.cat,
          headline: s.headline,
          source: s.source,
          url: s.url,
          summary: s.summary || [],
          fullText: s.fullText || "",
          image: s.image || "",
          linked: s.linked || null,
          overview: s.overview || [],
        }));
      return json(200, {
        id: meta.date,
        date: meta.dateLabel,
        weekday: meta.weekday,
        full: meta.full,
        hero: meta.hero || "",
        inProgress: !!meta.inProgress,
        stories,
      });
    }

    // POST /editions  -> upsert (the 5PM digest job)
    if (method === "POST" && path === "/editions") {
      const payload = JSON.parse(event.body || "{}");
      const date = payload.id; // YYYY-MM-DD
      if (!date || !Array.isArray(payload.stories)) {
        return json(400, { error: "id and stories[] required" });
      }
      const pk = `EDITION#${date}`;
      // META row (indexed by GSI)
      const meta = {
        pk,
        sk: "META",
        itemType: "EDITION",
        date,
        dateLabel: payload.date || date,
        weekday: payload.weekday || "",
        full: payload.full || "",
        count: payload.stories.length,
        lead: payload.stories[0]?.headline || "",
        hero: payload.hero || payload.stories.find((s) => s.image)?.image || "",
        inProgress: !!payload.inProgress,
      };
      const storyItems = payload.stories.map((s, i) => ({
        pk,
        sk: `STORY#${String(i).padStart(3, "0")}`,
        cat: s.cat || "tech",
        headline: s.headline || "",
        source: s.source || "",
        url: s.url || "",
        summary: s.summary || [],
        fullText: s.fullText || "",
        image: s.image || "",
        linked: s.linked && s.linked.url ? s.linked : undefined,
        overview: Array.isArray(s.overview) ? s.overview.slice(0, 6) : [],
      }));
      // Write META first, then stories in batches of 25.
      await ddb.send(new PutCommand({ TableName: TABLE, Item: meta }));
      for (let i = 0; i < storyItems.length; i += 25) {
        const batch = storyItems.slice(i, i + 25);
        await ddb.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE]: batch.map((Item) => ({ PutRequest: { Item } })),
            },
          })
        );
      }
      // Drop stale story rows past the new count (a live edition overwritten
      // by a shorter finished digest would otherwise keep ghost stories).
      const existing = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "pk = :p AND begins_with(sk, :s)",
          ExpressionAttributeValues: { ":p": pk, ":s": "STORY#" },
          ProjectionExpression: "pk, sk",
        })
      );
      const keep = new Set(storyItems.map((s) => s.sk));
      const stale = (existing.Items || []).filter((it) => !keep.has(it.sk));
      for (let i = 0; i < stale.length; i += 25) {
        await ddb.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE]: stale.slice(i, i + 25).map((k) => ({
                DeleteRequest: { Key: { pk: k.pk, sk: k.sk } },
              })),
            },
          })
        );
      }
      return json(200, { ok: true, date, stories: storyItems.length, removed: stale.length });
    }

    return json(404, { error: "no route", method, path });
  } catch (err) {
    console.error("handler error", err);
    return json(500, { error: String(err && err.message ? err.message : err) });
  }
};
