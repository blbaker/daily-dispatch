// User settings shared by every client: notification preferences and the
// optional daily podcast episode (roadmap decision 5). Stored as one row,
// pk "SETTINGS" / sk "CURRENT". Defaults fill any field a stored row lacks, so
// adding a field never needs a migration.
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Deps } from "./deps";
import { HttpError } from "./http";

export interface NotificationPrefs {
  /** Master switch: false silences every event. */
  enabled: boolean;
  newEdition: boolean;
  newEpisode: boolean;
}

export interface PodcastSettings {
  /** Generate an episode every day. Off by default. */
  enabled: boolean;
  /** Local wall-clock time, "HH:MM" 24-hour, in `timezone`. */
  time: string;
  /** IANA time zone name, for example "America/Chicago". */
  timezone: string;
  /** VoiceProvider adapter id, for example "elevenlabs". */
  voiceProvider: string;
  /** ScriptWriter adapter id, for example "command". */
  scriptWriter: string;
  /** Host name -> provider voice id. */
  hostVoices: Record<string, string>;
}

export interface Settings {
  notifications: NotificationPrefs;
  podcast: PodcastSettings;
  /** ISO time of the last PUT, or null when never saved. */
  updatedAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  notifications: { enabled: true, newEdition: true, newEpisode: true },
  podcast: {
    enabled: false,
    time: "06:00",
    timezone: "UTC",
    voiceProvider: "elevenlabs",
    scriptWriter: "command",
    hostVoices: {},
  },
  updatedAt: null,
};

const KEY = { pk: "SETTINGS", sk: "CURRENT" };
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const bad = (field: string, why: string) => new HttpError(400, `${field} ${why}`);

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function checkBoolean(field: string, v: unknown): boolean {
  if (typeof v !== "boolean") throw bad(field, "must be true or false");
  return v;
}

function checkHostVoices(field: string, v: unknown): Record<string, string> {
  if (!isObj(v)) throw bad(field, "must be an object of host name -> voice id");
  const entries = Object.entries(v);
  if (entries.length > 4) throw bad(field, "allows at most 4 hosts");
  for (const [name, voice] of entries) {
    if (name.length < 1 || name.length > 40 || typeof voice !== "string" || voice.length < 1 || voice.length > 200) {
      throw bad(field, "must map host names (1-40 chars) to voice ids (1-200 chars)");
    }
  }
  return v as Record<string, string>;
}

const PODCAST_FIELDS: Record<keyof PodcastSettings, (field: string, v: unknown) => unknown> = {
  enabled: checkBoolean,
  time: (f, v) => {
    if (typeof v !== "string" || !HHMM.test(v)) throw bad(f, "must be HH:MM (24-hour)");
    return v;
  },
  timezone: (f, v) => {
    if (typeof v !== "string" || !validTimeZone(v)) throw bad(f, "must be an IANA time zone");
    return v;
  },
  voiceProvider: (f, v) => {
    if (typeof v !== "string" || !SLUG.test(v)) throw bad(f, "must be a provider id like elevenlabs");
    return v;
  },
  scriptWriter: (f, v) => {
    if (typeof v !== "string" || !SLUG.test(v)) throw bad(f, "must be a writer id like command");
    return v;
  },
  hostVoices: checkHostVoices,
};

const NOTIFICATION_FIELDS: Record<keyof NotificationPrefs, (field: string, v: unknown) => unknown> = {
  enabled: checkBoolean,
  newEdition: checkBoolean,
  newEpisode: checkBoolean,
};

function mergeSection<T extends object>(
  name: string,
  current: T,
  patch: unknown,
  fields: Record<string, (field: string, v: unknown) => unknown>,
): T {
  if (patch === undefined) return current;
  if (!isObj(patch)) throw bad(name, "must be an object");
  const out: Obj = { ...(current as Obj) };
  for (const [k, v] of Object.entries(patch)) {
    const check = Object.hasOwn(fields, k) ? fields[k] : undefined;
    if (!check) throw bad(`${name}.${k}`, "is not a known setting");
    out[k] = check(`${name}.${k}`, v);
  }
  return out as T;
}

/** Applies a partial update; throws HttpError(400) naming the bad field. */
export function mergeSettings(current: Settings, patch: Obj, now: Date): Settings {
  for (const k of Object.keys(patch)) {
    if (k !== "notifications" && k !== "podcast") throw bad(k, "is not a known settings section");
  }
  return {
    notifications: mergeSection("notifications", current.notifications, patch.notifications, NOTIFICATION_FIELDS),
    podcast: mergeSection("podcast", current.podcast, patch.podcast, PODCAST_FIELDS),
    updatedAt: now.toISOString(),
  };
}

/** Stored row merged over defaults. */
export async function loadSettings(deps: Deps): Promise<Settings> {
  const res = await deps.ddb.send(new GetCommand({ TableName: deps.env.table, Key: KEY }));
  const item = (res.Item || {}) as Obj;
  return {
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(isObj(item.notifications) ? item.notifications : {}) },
    podcast: { ...DEFAULT_SETTINGS.podcast, ...(isObj(item.podcast) ? item.podcast : {}) },
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
  };
}

export async function saveSettings(deps: Deps, s: Settings): Promise<void> {
  await deps.ddb.send(new PutCommand({ TableName: deps.env.table, Item: { ...KEY, ...s } }));
}
