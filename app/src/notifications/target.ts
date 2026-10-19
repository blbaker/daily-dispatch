// Turns a push payload into the screen a tap should open, and back and forth
// to the query string the web service worker opens the app with.
// public/sw.js carries a copy of targetFromData and targetToQuery (a service
// worker cannot import app code); test/notifications/sw.test.ts runs the
// same cases against it.
import type { OpenTarget } from "./types";

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PATH = /^\/(editions|episodes)\/([A-Za-z0-9_-]{1,64})$/;

export function targetFromData(data: unknown): OpenTarget | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: unknown; id?: unknown; path?: unknown };
  if ((d.type === "edition" || d.type === "episode") && typeof d.id === "string" && SAFE_ID.test(d.id)) {
    return { kind: d.type, id: d.id };
  }
  const m = typeof d.path === "string" ? PATH.exec(d.path) : null;
  if (!m) return null;
  return { kind: m[1] === "editions" ? "edition" : "episode", id: m[2] };
}

export function targetToQuery(target: OpenTarget): string {
  return `?${target.kind}=${encodeURIComponent(target.id)}`;
}

export function targetFromQuery(search: string): OpenTarget | null {
  const q = new URLSearchParams(search);
  for (const kind of ["edition", "episode"] as const) {
    const id = q.get(kind);
    if (id && SAFE_ID.test(id)) return { kind, id };
  }
  return null;
}
