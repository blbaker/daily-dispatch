// Validation for settings values. The podcast checks mirror the backend's
// (backend/lambda/settings.ts), so a value the app accepts is never one
// PUT /settings rejects with a 400.
import {
  TEXT_SCALES, type PodcastSettings, type ReadingSettings, type ServerSettings, type TextScale,
} from "./types";

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;

function validTimeZone(tz: string): boolean {
  // A JS engine built without time zone data cannot check the name, so it
  // falls back to the shape of one; the backend still checks it for real.
  if (typeof Intl === "undefined" || !intlHasZones()) return ZONE_NAME.test(tz);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function intlHasZones(): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago" });
    return true;
  } catch {
    return false;
  }
}

function hostVoicesOk(v: unknown): v is Record<string, string> {
  if (!isObj(v)) return false;
  const entries = Object.entries(v);
  if (entries.length > 4) return false;
  return entries.every(([name, id]) =>
    name.length >= 1 && name.length <= 40 && typeof id === "string" && id.length >= 1 && id.length <= 200);
}

const PODCAST_CHECKS: { [K in keyof PodcastSettings]: (v: unknown) => boolean } = {
  enabled: (v) => typeof v === "boolean",
  time: (v) => typeof v === "string" && HHMM.test(v),
  timezone: (v) => typeof v === "string" && validTimeZone(v),
  voiceProvider: (v) => typeof v === "string" && SLUG.test(v),
  scriptWriter: (v) => typeof v === "string" && SLUG.test(v),
  hostVoices: hostVoicesOk,
};

const READING_CHECKS: { [K in keyof ReadingSettings]: (v: unknown) => boolean } = {
  textScale: (v) => (TEXT_SCALES as readonly unknown[]).includes(v),
  eink: (v) => typeof v === "boolean",
};

const nullableString = (v: unknown) => v === null || typeof v === "string";
const SERVER_CHECKS: { [K in keyof ServerSettings]: (v: unknown) => boolean } = {
  apiUrl: nullableString,
  apiKey: nullableString,
};

function checker<T extends object>(section: string, checks: Record<string, (v: unknown) => boolean>) {
  /** Throws a TypeError naming the first bad field of a patch. */
  const check = (patch: Partial<T>): Partial<T> => {
    for (const [k, v] of Object.entries(patch)) {
      // Not Object.hasOwn: older Hermes builds lack it.
      const ok = Object.prototype.hasOwnProperty.call(checks, k) ? checks[k] : undefined;
      if (!ok) throw new TypeError(`${section}.${k} is not a setting`);
      if (!ok(v)) throw new TypeError(`${section}.${k} has a bad value`);
    }
    return patch;
  };
  /** Keeps the fields of a stored value that pass, the defaults for the rest. */
  const repair = (raw: unknown, defaults: T): T => {
    const out: Obj = { ...(defaults as Obj) };
    if (isObj(raw)) {
      for (const k of Object.keys(checks)) if (k in raw && checks[k](raw[k])) out[k] = raw[k];
    }
    return out as T;
  };
  return { check, repair };
}

export const podcastRules = checker<PodcastSettings>("podcast", PODCAST_CHECKS);
export const readingRules = checker<ReadingSettings>("reading", READING_CHECKS);
export const serverRules = checker<ServerSettings>("server", SERVER_CHECKS);

export function isTextScale(v: unknown): v is TextScale {
  return READING_CHECKS.textScale(v);
}

/** Order-sensitive deep equality for the plain JSON values settings hold. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
