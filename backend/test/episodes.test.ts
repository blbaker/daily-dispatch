import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { caller, ev } from "./helpers";
import { deviceRow, fakeProviders } from "./fakes";
import { presign } from "../lambda/presign";

const ddb = mockClient(DynamoDBDocumentClient);

const META = { id: "2026-10-19", title: "Monday: chips, rockets and a bridge", durationSec: 912 };
const stored = (status: "uploading" | "ready") => ({
  pk: "EPISODE#2026-10-19", sk: "META", itemType: "EPISODE", id: "2026-10-19", date: "2026-10-19",
  title: META.title, description: "", durationSec: 912, contentType: "audio/mpeg",
  audioKey: "episodes/2026-10-19.mp3", status, createdAt: "2026-10-19T11:00:00.000Z", updatedAt: "2026-10-19T11:00:00.000Z",
});

const headFetch = (status: number) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status }));
const episodePuts = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item!).filter((i) => i.sk === "META");

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand).resolves({});
  ddb.on(PutCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(BatchWriteCommand).resolves({});
  ddb.on(DeleteCommand).resolves({});
});

describe("POST /episodes", () => {
  it("stores the metadata as uploading and returns a presigned PUT URL without notifying", async () => {
    const f = fakeProviders();
    const r = await caller({ push: f.push })(ev("POST", "/episodes", { body: META }));
    expect(r.status).toBe(200);
    expect(episodePuts()[0]).toMatchObject({
      pk: "EPISODE#2026-10-19", itemType: "EPISODE", date: "2026-10-19", status: "uploading", audioKey: "episodes/2026-10-19.mp3",
    });
    expect(r.body.episode).toMatchObject({ id: "2026-10-19", title: META.title, status: "uploading" });
    expect(r.body.upload).toMatchObject({ method: "PUT", headers: { "content-type": "audio/mpeg" }, expiresIn: 3600 });
    expect(r.body.upload.url).toMatch(/^https:\/\/test-media\.s3\.us-west-2\.amazonaws\.com\/episodes\/2026-10-19\.mp3\?/);
    expect(r.body.push).toBeUndefined();
    expect(ddb.commandCalls(PutCommand).filter((c) => c.args[0].input.Item?.pk === "NOTIFIED")).toHaveLength(0);
  });

  it("uses .m4a for audio/mp4", async () => {
    const r = await caller()(ev("POST", "/episodes", { body: { ...META, contentType: "audio/mp4" } }));
    expect(r.body.episode.audioKey).toBe("episodes/2026-10-19.m4a");
  });

  it.each([
    [{ ...META, id: "Bad Id" }, "id"],
    [{ id: "2026-10-19" }, "title"],
    [{ ...META, contentType: "video/mp4" }, "contentType"],
    [{ ...META, date: "19/10/2026" }, "date"],
    [{ ...META, durationSec: -3 }, "durationSec"],
  ])("rejects %j naming %s", async (body, field) => {
    const r = await caller()(ev("POST", "/episodes", { body }));
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(field);
  });

  it("refuses ready:true until the audio is in the bucket", async () => {
    ddb.on(GetCommand, { Key: { pk: "EPISODE#2026-10-19" } }).resolves({ Item: stored("uploading") });
    const fetch = headFetch(404);
    const f = fakeProviders();
    const r = await caller({ fetch: fetch as never, push: f.push })(ev("POST", "/episodes", { body: { id: "2026-10-19", ready: true } }));
    expect(r.status).toBe(409);
    expect(fetch.mock.calls[0][1]?.method).toBe("HEAD");
    expect(String(fetch.mock.calls[0][0])).toContain("/episodes/2026-10-19.mp3?");
    expect(f.expo.sent).toHaveLength(0);
  });

  it("marks the episode ready and notifies devices that want new episodes", async () => {
    ddb.on(GetCommand, { Key: { pk: "EPISODE#2026-10-19" } }).resolves({ Item: stored("uploading") });
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ":p": "DEVICE" } }).resolves({
      Items: [deviceRow("a", "expo"), deviceRow("b", "expo", { newEpisode: false }), deviceRow("c", "webpush")],
    });
    const f = fakeProviders();
    const r = await caller({ fetch: headFetch(200) as never, push: f.push })(
      ev("POST", "/episodes", { body: { id: "2026-10-19", ready: true } }),
    );
    expect(r.status).toBe(200);
    expect(episodePuts()[0]).toMatchObject({ status: "ready", title: META.title, createdAt: "2026-10-19T11:00:00.000Z" });
    expect(r.body.push).toMatchObject({ recorded: true, sent: 2 });
    expect(f.expo.sent[0].devices.map((d) => d.id)).toEqual(["a"]);
    expect(f.expo.sent[0].msg).toEqual({
      title: "New episode ready",
      body: META.title,
      data: { type: "episode", id: "2026-10-19", path: "/episodes/2026-10-19" },
    });
  });

  it("needs the metadata on first sight even when ready:true", async () => {
    const r = await caller({ fetch: headFetch(200) as never })(ev("POST", "/episodes", { body: { id: "2026-10-19", ready: true } }));
    expect(r.status).toBe(400);
  });
});

describe("GET /episodes", () => {
  it("returns one ready episode with a presigned audio URL", async () => {
    ddb.on(GetCommand, { Key: { pk: "EPISODE#2026-10-19" } }).resolves({ Item: stored("ready") });
    const r = await caller()(ev("GET", "/episodes/2026-10-19"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "2026-10-19", title: META.title, durationSec: 912, status: "ready" });
    expect(r.body.audioUrl).toMatch(/^https:\/\/test-media\.s3\.us-west-2\.amazonaws\.com\/episodes\/2026-10-19\.mp3\?/);
  });

  it("hides an episode whose audio is still uploading", async () => {
    ddb.on(GetCommand, { Key: { pk: "EPISODE#2026-10-19" } }).resolves({ Item: stored("uploading") });
    expect((await caller()(ev("GET", "/episodes/2026-10-19"))).status).toBe(404);
  });

  it("lists ready episodes newest first from the type index", async () => {
    ddb.on(QueryCommand).resolves({ Items: [stored("ready"), { ...stored("uploading"), id: "2026-10-20" }] });
    const r = await caller()(ev("GET", "/episodes"));
    expect(r.body.episodes.map((e: { id: string }) => e.id)).toEqual(["2026-10-19"]);
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({
      IndexName: "byType", ScanIndexForward: false, ExpressionAttributeValues: { ":t": "EPISODE" },
    });
  });
});

describe("presign", () => {
  it("signs the HTTP method, so a GET URL cannot be used to PUT", () => {
    const o = { bucket: "b", key: "episodes/x.mp3", region: "us-west-2", creds: { accessKeyId: "AKID", secretAccessKey: "s" }, now: new Date(0) };
    const sig = (u: string) => new URL(u).searchParams.get("X-Amz-Signature");
    expect(sig(presign({ ...o, method: "PUT" }))).not.toBe(sig(presign({ ...o, method: "GET" })));
    expect(sig(presign({ ...o, method: "HEAD" }))).not.toBe(sig(presign({ ...o, method: "GET" })));
  });
});
