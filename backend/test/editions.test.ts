// Characterization tests for the editions API and auth gate. They were written
// against the original JavaScript handler and must keep passing unchanged
// after the TypeScript port.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ev, parse } from "./helpers";
import { handler } from "../lambda/handler";

const ddb = mockClient(DynamoDBDocumentClient);
const call = async (e: ReturnType<typeof ev>) => parse(await handler(e as never));

beforeEach(() => ddb.reset());
afterEach(() => vi.unstubAllGlobals());

describe("auth gate", () => {
  it("serves /health without a key", async () => {
    expect(await call(ev("GET", "/health", { key: null }))).toEqual({ status: 200, body: { ok: true } });
  });

  it("rejects a missing key", async () => {
    expect((await call(ev("GET", "/editions", { key: null }))).status).toBe(401);
  });

  it("rejects a wrong key of the same length", async () => {
    expect((await call(ev("GET", "/editions", { key: "test-kez" }))).status).toBe(401);
  });

  it("accepts the key as a query parameter", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    const r = await call(ev("GET", "/editions", { key: null, query: { key: "test-key" } }));
    expect(r.status).toBe(200);
  });

  it("returns 404 with the method and path for an unknown route", async () => {
    const r = await call(ev("GET", "/nope"));
    expect(r).toEqual({ status: 404, body: { error: "no route", method: "GET", path: "/nope" } });
  });
});

describe("GET /editions", () => {
  it("lists edition metadata from the type index, newest first", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [{ date: "2026-10-19", dateLabel: "October 19", weekday: "monday", full: "Monday", count: 3, lead: "Lead" }],
    });
    const r = await call(ev("GET", "/editions"));
    expect(r.body.editions).toEqual([
      { id: "2026-10-19", date: "October 19", weekday: "monday", full: "Monday", count: 3, lead: "Lead", hero: "", inProgress: false },
    ]);
    const input = ddb.commandCalls(QueryCommand)[0].args[0].input;
    expect(input).toMatchObject({ IndexName: "byType", ScanIndexForward: false, ExpressionAttributeValues: { ":t": "EDITION" } });
  });
});

describe("GET /editions/<date>", () => {
  it("returns 404 when the edition has no META row", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect((await call(ev("GET", "/editions/2026-10-19"))).status).toBe(404);
  });

  it("returns the edition with its stories in order", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { sk: "STORY#001", cat: "news", headline: "Second", source: "b", url: "u2" },
        { sk: "META", date: "2026-10-19", dateLabel: "October 19", weekday: "monday", full: "Monday" },
        { sk: "STORY#000", cat: "tech", headline: "First", source: "a", url: "u1", summary: ["s"] },
      ],
    });
    const r = await call(ev("GET", "/editions/2026-10-19"));
    expect(r.status).toBe(200);
    expect(r.body.stories.map((s: { headline: string }) => s.headline)).toEqual(["First", "Second"]);
    expect(r.body.stories[1]).toEqual({
      cat: "news", headline: "Second", source: "b", url: "u2", summary: [], fullText: "", image: "", linked: null, overview: [],
    });
  });
});

describe("POST /editions", () => {
  it("rejects a payload without stories", async () => {
    expect((await call(ev("POST", "/editions", { body: { id: "2026-10-19" } }))).status).toBe(400);
  });

  it("writes META, batches stories by 25 and deletes stale stories", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [{ pk: "EDITION#2026-10-19", sk: "STORY#029" }, { pk: "EDITION#2026-10-19", sk: "STORY#030" }],
    });
    const stories = Array.from({ length: 30 }, (_, i) => ({ headline: `h${i}` }));
    const r = await call(ev("POST", "/editions", { body: { id: "2026-10-19", stories, inProgress: true } }));
    expect(r).toEqual({ status: 200, body: { ok: true, date: "2026-10-19", stories: 30, removed: 1 } });
    const meta = ddb.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(meta).toMatchObject({ pk: "EDITION#2026-10-19", sk: "META", itemType: "EDITION", count: 30, lead: "h0" });
    const batches = ddb.commandCalls(BatchWriteCommand).map((c) => c.args[0].input.RequestItems!["test-table"]);
    expect(batches.map((b) => b.length)).toEqual([25, 5, 1]);
    expect(batches[2][0]).toEqual({ DeleteRequest: { Key: { pk: "EDITION#2026-10-19", sk: "STORY#030" } } });
  });
});

describe("GET /app/latest", () => {
  it("reads the release manifest and returns a presigned APK URL", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ versionCode: 7, key: "releases/app-7.apk", size: 9 })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await call(ev("GET", "/app/latest", { query: { variant: "eink" } }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ versionCode: 7, versionName: "7", notes: "", size: 9 });
    expect(r.body.url).toContain("test-releases.s3.us-west-2.amazonaws.com/releases/app-7.apk?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/releases/latest-eink.json?");
  });

  it("returns 404 when no manifest exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect((await call(ev("GET", "/app/latest"))).status).toBe(404);
  });
});
