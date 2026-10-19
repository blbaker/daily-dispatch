// Builders for Lambda Function URL events (payload format 2.0) and a parser
// for the handler's JSON responses.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Deps, readEnv } from "../lambda/deps";
import { createHandler } from "../lambda/handler";

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

export const NOW = new Date("2026-10-19T22:00:00.000Z");

/** Deps for createHandler with a fixed clock, a fetch stub and a log spy. */
export function testDeps(over: Partial<Deps> = {}): Deps {
  return {
    ddb: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-west-2" })),
    env: readEnv(),
    creds: () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "test-secret" }),
    fetch: (async () => {
      throw new Error("unexpected fetch in test");
    }) as typeof fetch,
    now: () => NOW,
    log: () => undefined,
    ...over,
  };
}

/** Builds a handler over testDeps and returns a call(event) -> Parsed helper. */
export function caller(over: Partial<Deps> = {}) {
  const h = createHandler(testDeps(over));
  return async (e: ReturnType<typeof ev>) => parse((await h(e as never)) as never);
}
