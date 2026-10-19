// HTTP plumbing for the Lambda Function URL (payload format 2.0): event
// shape, JSON responses, API-key auth and body parsing.
import * as crypto from "crypto";

export interface HttpEvent {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Thrown by route code to return a specific status with an error message. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(status: number, body: unknown): HttpResult {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function methodAndPath(event: HttpEvent): { method: string; path: string } {
  const method = event.requestContext?.http?.method || "GET";
  let path = event.rawPath || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return { method, path };
}

export function extractKey(event: HttpEvent): string {
  const h = event.headers || {};
  const headerKey = h["x-api-key"] || h["X-Api-Key"];
  if (headerKey) return headerKey;
  const q = event.queryStringParameters || {};
  return q.key || q.apiKey || "";
}

/** Constant-time comparison so the key cannot be guessed by timing. */
export function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function query(event: HttpEvent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.queryStringParameters || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Parses the request body as a JSON object; anything else is a 400. */
export function readJson(event: HttpEvent): Record<string, unknown> {
  let raw = event.body || "{}";
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
