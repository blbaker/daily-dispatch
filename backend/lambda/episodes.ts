// Podcast episodes. Audio lives in the media bucket; metadata is one row:
//   pk = "EPISODE#<id>"  sk = "META"  (itemType EPISODE, in the type index)
// An episode is "uploading" until its publisher confirms the audio is in
// the bucket, then "ready". Only ready episodes are listed or notified.
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Deps } from "./deps";
import { HttpError } from "./http";
import { presign } from "./presign";

export const EPISODE_ID = "([a-z0-9][a-z0-9-]{0,63})";
const ID = new RegExp(`^${EPISODE_ID}$`);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AUDIO_TYPES: Record<string, string> = { "audio/mpeg": "mp3", "audio/mp4": "m4a" };

export interface Episode {
  id: string;
  date: string;
  title: string;
  description: string;
  durationSec: number | null;
  contentType: string;
  audioKey: string;
  status: "uploading" | "ready";
  createdAt: string;
  updatedAt: string;
}

type Obj = Record<string, unknown>;
const bad = (field: string, why: string) => new HttpError(400, `${field} ${why}`);

function optString(body: Obj, field: string, max: number): string | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.length > max) throw bad(field, `must be a string of at most ${max} characters`);
  return v;
}

/** Validates a POST /episodes body and merges it over the stored episode, if any. */
export function mergeEpisode(body: Obj, existing: Episode | null, now: Date): Episode {
  const id = body.id;
  if (typeof id !== "string" || !ID.test(id)) throw bad("id", "must be a lowercase slug such as 2026-10-19");
  const title = optString(body, "title", 200) ?? existing?.title;
  if (!title) throw bad("title", "is required");
  const date = optString(body, "date", 10) ?? existing?.date ?? (DATE.test(id) ? id : now.toISOString().slice(0, 10));
  if (!DATE.test(date) || Number.isNaN(Date.parse(date))) throw bad("date", "must be YYYY-MM-DD");
  const contentType = optString(body, "contentType", 40) ?? existing?.contentType ?? "audio/mpeg";
  const ext = AUDIO_TYPES[contentType];
  if (!ext) throw bad("contentType", `must be one of ${Object.keys(AUDIO_TYPES).join(", ")}`);
  let durationSec = existing?.durationSec ?? null;
  if (body.durationSec !== undefined) {
    const d = body.durationSec;
    if (typeof d !== "number" || !Number.isFinite(d) || d < 0 || d > 86400) throw bad("durationSec", "must be 0-86400");
    durationSec = Math.round(d);
  }
  const stamp = now.toISOString();
  return {
    id,
    date,
    title,
    description: optString(body, "description", 2000) ?? existing?.description ?? "",
    durationSec,
    contentType,
    audioKey: `episodes/${id}.${ext}`,
    status: existing?.status ?? "uploading",
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  };
}

function fromItem(item: Obj): Episode {
  const { pk: _pk, sk: _sk, itemType: _t, ...rest } = item;
  return rest as unknown as Episode;
}

export async function getEpisode(deps: Deps, id: string): Promise<Episode | null> {
  const res = await deps.ddb.send(
    new GetCommand({ TableName: deps.env.table, Key: { pk: `EPISODE#${id}`, sk: "META" } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function putEpisode(deps: Deps, e: Episode): Promise<void> {
  await deps.ddb.send(
    new PutCommand({ TableName: deps.env.table, Item: { pk: `EPISODE#${e.id}`, sk: "META", itemType: "EPISODE", ...e } }),
  );
}

export async function listEpisodes(deps: Deps): Promise<Episode[]> {
  const res = await deps.ddb.send(
    new QueryCommand({
      TableName: deps.env.table,
      IndexName: deps.env.gsi,
      KeyConditionExpression: "itemType = :t",
      ExpressionAttributeValues: { ":t": "EPISODE" },
      ScanIndexForward: false, // newest first
    }),
  );
  return (res.Items || []).map(fromItem);
}

export function audioUrl(deps: Deps, e: Episode, method: "GET" | "PUT" | "HEAD", expires: number): string {
  return presign({ method, bucket: deps.env.mediaBucket, key: e.audioKey, region: deps.env.region, creds: deps.creds(), expires });
}

/** True when the audio object exists, checked with a presigned HEAD. */
export async function audioUploaded(deps: Deps, e: Episode): Promise<boolean> {
  const r = await deps.fetch(audioUrl(deps, e, "HEAD", 60), { method: "HEAD" });
  return r.ok;
}
