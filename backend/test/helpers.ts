// Builders for Lambda Function URL events (payload format 2.0) and a parser
// for the handler's JSON responses.
export const KEY = "test-key";

export interface EventOpts {
  body?: unknown;
  query?: Record<string, string>;
  /** API key to send; null sends none. Defaults to the test key. */
  key?: string | null;
  headers?: Record<string, string>;
}

export function ev(method: string, path: string, o: EventOpts = {}) {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.key !== null) headers["x-api-key"] = o.key ?? KEY;
  let body: string | undefined;
  if (typeof o.body === "string") body = o.body;
  else if (o.body !== undefined) body = JSON.stringify(o.body);
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers,
    queryStringParameters: o.query,
    body,
    isBase64Encoded: false,
  };
}

export interface Parsed {
  status: number;
  body: any;
}

export function parse(res: { statusCode: number; body: string }): Parsed {
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
