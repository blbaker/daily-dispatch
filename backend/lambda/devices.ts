// Device registrations. One row per device in a single partition so fan-out
// reads them all with one query:
//   pk = "DEVICE"  sk = <id>
// The id is derived from the push token (or Web Push endpoint), so a client
// that registers again on every launch updates its row instead of adding one.
import * as crypto from "crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Deps } from "./deps";
import { HttpError } from "./http";
import { NotificationPrefs } from "./settings";

export const PLATFORMS = ["ios", "android", "web", "desktop"] as const;
export const KINDS = ["expo", "webpush", "poll"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type DeviceKind = (typeof KINDS)[number];

export interface WebPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface Device {
  id: string;
  platform: Platform;
  kind: DeviceKind;
  /** Expo push token, or a poller's install id. */
  token?: string;
  subscription?: WebPushSubscription;
  prefs: NotificationPrefs;
  name?: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_DEVICE_PREFS: NotificationPrefs = { enabled: true, newEdition: true, newEpisode: true };

const PK = "DEVICE";
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]{1,200}\]$/;
const INSTALL_ID = /^[A-Za-z0-9_-]{8,200}$/;
const B64URL = /^[A-Za-z0-9_-]{8,200}={0,2}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const bad = (field: string, why: string) => new HttpError(400, `${field} ${why}`);

export function deviceId(kind: DeviceKind, key: string): string {
  return crypto.createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 24);
}

function checkSubscription(v: unknown): WebPushSubscription {
  const msg = "must be a PushSubscription with an https endpoint and p256dh/auth keys";
  if (!isObj(v) || typeof v.endpoint !== "string" || !isObj(v.keys)) throw bad("subscription", msg);
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    throw bad("subscription", msg);
  }
  const { p256dh, auth } = v.keys;
  if (url.protocol !== "https:" || typeof p256dh !== "string" || typeof auth !== "string") {
    throw bad("subscription", msg);
  }
  if (!B64URL.test(p256dh) || !B64URL.test(auth)) throw bad("subscription", msg);
  const exp = v.expirationTime;
  return {
    endpoint: v.endpoint,
    expirationTime: typeof exp === "number" ? exp : null,
    keys: { p256dh, auth },
  };
}

export function checkPrefs(v: unknown, base: NotificationPrefs): NotificationPrefs {
  if (v === undefined) return base;
  if (!isObj(v)) throw bad("prefs", "must be an object");
  const out: NotificationPrefs = { ...base };
  for (const [k, val] of Object.entries(v)) {
    if (k !== "enabled" && k !== "newEdition" && k !== "newEpisode") throw bad(`prefs.${k}`, "is not a known pref");
    if (typeof val !== "boolean") throw bad(`prefs.${k}`, "must be true or false");
    out[k] = val;
  }
  return out;
}

/** Validates a POST /devices body into the identifying fields of a device. */
export function parseRegistration(body: Obj) {
  const { platform, kind } = body;
  if (!PLATFORMS.includes(platform as Platform)) throw bad("platform", `must be one of ${PLATFORMS.join(", ")}`);
  if (!KINDS.includes(kind as DeviceKind)) throw bad("kind", `must be one of ${KINDS.join(", ")}`);
  const p = platform as Platform;
  const name = typeof body.name === "string" ? body.name.slice(0, 80) : undefined;
  if (kind === "expo") {
    if (p !== "ios" && p !== "android") throw bad("platform", "must be ios or android for kind expo");
    if (typeof body.token !== "string" || !EXPO_TOKEN.test(body.token)) {
      throw bad("token", "must be an Expo push token like ExponentPushToken[...]");
    }
    return { id: deviceId("expo", body.token), platform: p, kind, token: body.token, name } as const;
  }
  if (kind === "webpush") {
    if (p !== "web") throw bad("platform", "must be web for kind webpush");
    const subscription = checkSubscription(body.subscription);
    return { id: deviceId("webpush", subscription.endpoint), platform: p, kind, subscription, name } as const;
  }
  if (typeof body.token !== "string" || !INSTALL_ID.test(body.token)) {
    throw bad("token", "must be a stable install id (8-200 chars of A-Z, a-z, 0-9, _ or -) for kind poll");
  }
  return { id: deviceId("poll", body.token), platform: p, kind: "poll", token: body.token, name } as const;
}

/** The device as clients see it: no token or subscription echoed back. */
export function publicDevice(d: Device) {
  const { id, platform, kind, prefs, name, createdAt, updatedAt } = d;
  return { id, platform, kind, prefs, ...(name ? { name } : {}), createdAt, updatedAt };
}

function fromItem(item: Obj): Device {
  const { pk: _pk, sk, ...rest } = item;
  return { ...(rest as Omit<Device, "id">), id: String(sk) };
}

export async function getDevice(deps: Deps, id: string): Promise<Device | null> {
  const res = await deps.ddb.send(new GetCommand({ TableName: deps.env.table, Key: { pk: PK, sk: id } }));
  return res.Item ? fromItem(res.Item) : null;
}

export async function putDevice(deps: Deps, d: Device): Promise<void> {
  const { id, ...rest } = d;
  await deps.ddb.send(new PutCommand({ TableName: deps.env.table, Item: { pk: PK, sk: id, ...rest } }));
}

export async function deleteDevice(deps: Deps, id: string): Promise<boolean> {
  const res = await deps.ddb.send(
    new DeleteCommand({ TableName: deps.env.table, Key: { pk: PK, sk: id }, ReturnValues: "ALL_OLD" }),
  );
  return !!res.Attributes;
}

export async function listDevices(deps: Deps): Promise<Device[]> {
  const out: Device[] = [];
  let start: Obj | undefined;
  do {
    const res = await deps.ddb.send(
      new QueryCommand({
        TableName: deps.env.table,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": PK },
        ExclusiveStartKey: start,
      }),
    );
    for (const it of res.Items || []) out.push(fromItem(it));
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}
