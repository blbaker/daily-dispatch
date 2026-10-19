// Edition routes. Single-table layout:
//   META row:   pk = "EDITION#<date>"  sk = "META"        (itemType EDITION, in the type index)
//   Story rows: pk = "EDITION#<date>"  sk = "STORY#<nnn>"
import { BatchWriteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Deps } from "../deps";
import { HttpError, json, readJson } from "../http";
import { PublishReport, publish } from "../push/fanout";
import { Route } from "../router";

type Row = Record<string, any>;

const listEditions: Route = {
  method: "GET",
  pattern: /^\/editions$/,
  run: async ({ deps }) => {
    const res = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.env.table,
        IndexName: deps.env.gsi,
        KeyConditionExpression: "itemType = :t",
        ExpressionAttributeValues: { ":t": "EDITION" },
        ScanIndexForward: false, // newest first
      }),
    );
    const editions = ((res.Items || []) as Row[]).map((it) => ({
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
  },
};

const getEdition: Route = {
  method: "GET",
  pattern: /^\/editions\/(\d{4}-\d{2}-\d{2})$/,
  run: async ({ deps, params }) => {
    const res = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.env.table,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": `EDITION#${params[0]}` },
      }),
    );
    const items = (res.Items || []) as Row[];
    const meta = items.find((i) => i.sk === "META");
    if (!meta) return json(404, { error: "not found" });
    const stories = items
      .filter((i) => String(i.sk).startsWith("STORY#"))
      .sort((a, b) => String(a.sk).localeCompare(String(b.sk)))
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
  },
};

export interface StoredEdition {
  date: string;
  count: number;
  lead: string;
  inProgress: boolean;
}

/** Upserts an edition and its stories; returns what was stored. */
export async function upsertEdition(
  deps: Deps,
  payload: Row,
): Promise<{ edition: StoredEdition; removed: number }> {
  const date = payload.id; // YYYY-MM-DD
  if (!date || !Array.isArray(payload.stories)) throw new HttpError(400, "id and stories[] required");
  const table = deps.env.table;
  const pk = `EDITION#${date}`;
  const stories = payload.stories as Row[];
  const meta = {
    pk,
    sk: "META",
    itemType: "EDITION",
    date,
    dateLabel: payload.date || date,
    weekday: payload.weekday || "",
    full: payload.full || "",
    count: stories.length,
    lead: stories[0]?.headline || "",
    hero: payload.hero || stories.find((s) => s.image)?.image || "",
    inProgress: !!payload.inProgress,
  };
  const storyItems = stories.map((s, i) => ({
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
  // META first, then stories in batches of 25 (the BatchWrite limit).
  await deps.ddb.send(new PutCommand({ TableName: table, Item: meta }));
  for (let i = 0; i < storyItems.length; i += 25) {
    const batch = storyItems.slice(i, i + 25);
    await deps.ddb.send(
      new BatchWriteCommand({
        RequestItems: { [table]: batch.map((Item) => ({ PutRequest: { Item } })) },
      }),
    );
  }
  // Drop story rows past the new count. A live edition overwritten by a
  // shorter finished digest would otherwise keep ghost stories.
  const existing = await deps.ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :p AND begins_with(sk, :s)",
      ExpressionAttributeValues: { ":p": pk, ":s": "STORY#" },
      ProjectionExpression: "pk, sk",
    }),
  );
  const keep = new Set(storyItems.map((s) => s.sk));
  const stale = ((existing.Items || []) as Row[]).filter((it) => !keep.has(it.sk));
  for (let i = 0; i < stale.length; i += 25) {
    await deps.ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: stale.slice(i, i + 25).map((k) => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } })),
        },
      }),
    );
  }
  return {
    edition: { date, count: meta.count, lead: meta.lead, inProgress: meta.inProgress },
    removed: stale.length,
  };
}

const DAY_MS = 86_400_000;

/**
 * True for yesterday, today or tomorrow (UTC). The 5 PM job re-posts every
 * finished edition it has; only a recent one should notify. Yesterday is
 * included because a Central-time evening edition is "tomorrow" in UTC.
 */
export function isRecentEdition(date: string, now: Date): boolean {
  const d = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(d)) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return d >= today - DAY_MS && d <= today + DAY_MS;
}

async function notifyEdition(deps: Deps, e: StoredEdition): Promise<PublishReport> {
  if (!isRecentEdition(e.date, deps.now())) return { recorded: false, reason: "old-edition" };
  const more = e.count - 1;
  return publish(deps, {
    event: "edition",
    refId: e.date,
    title: "New edition ready",
    body: more > 0 ? `${e.lead} + ${more} more ${more === 1 ? "story" : "stories"}` : e.lead || "Today's stories are in",
    data: { type: "edition", id: e.date, path: `/editions/${e.date}` },
  });
}

const postEdition: Route = {
  method: "POST",
  pattern: /^\/editions$/,
  run: async ({ deps, event }) => {
    const { edition, removed } = await upsertEdition(deps, readJson(event));
    const reply: Record<string, unknown> = { ok: true, date: edition.date, stories: edition.count, removed };
    // Live (in-progress) editions update all day; only a finished one notifies.
    if (!edition.inProgress) reply.push = await notifyEdition(deps, edition);
    return json(200, reply);
  },
};

export const editionRoutes: Route[] = [listEditions, getEdition, postEdition];
