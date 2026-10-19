import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createHandler } from "../lambda/handler";
import { caller, ev, testDeps } from "./helpers";
import { deviceRow, fakeProvider, fakeProviders } from "./fakes";

const ddb = mockClient(DynamoDBDocumentClient);
const DEVICE_ID = "0123456789abcdef01234567";

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(BatchWriteCommand).resolves({});
  ddb.on(DeleteCommand).resolves({ Attributes: {} });
});

const scheduled = { version: "0", source: "aws.events", "detail-type": "Scheduled Event", detail: {} };
const receipt = (id: string, deviceId: string, minutesAgo: number) => ({
  pk: "RECEIPT",
  sk: id,
  deviceId,
  sentAt: new Date(Date.parse("2026-10-19T22:00:00.000Z") - minutesAgo * 60_000).toISOString(),
});

describe("scheduled Expo receipt check", () => {
  it("asks only for tickets 15 min to 24 h old, prunes dead devices and forgets checked tickets", async () => {
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ":p": "RECEIPT" } }).resolves({
      Items: [receipt("fresh", "d0", 5), receipt("t1", "d1", 30), receipt("t2", "d2", 90), receipt("old", "d3", 25 * 60)],
    });
    const f = fakeProviders();
    f.expo.checkReceipts.mockResolvedValue({ checked: ["t1", "t2"], unregistered: ["t2"] });
    const report = await createHandler(testDeps({ push: f.push }))(scheduled as never);

    expect(f.expo.checkReceipts).toHaveBeenCalledWith(["t1", "t2"]);
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key)).toEqual([{ pk: "DEVICE", sk: "d2" }]);
    const forgotten = ddb
      .commandCalls(BatchWriteCommand)
      .flatMap((c) => c.args[0].input.RequestItems!["test-table"])
      .map((w) => w.DeleteRequest?.Key?.sk);
    expect(forgotten.sort()).toEqual(["old", "t1", "t2"]);
    expect(report).toEqual({ checked: 2, pruned: 1, expired: 1, pending: 1 });
  });

  it("still expires old tickets when the expo provider is disabled", async () => {
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ":p": "RECEIPT" } }).resolves({ Items: [receipt("old", "d3", 25 * 60)] });
    const f = fakeProviders(fakeProvider("expo", false));
    const report = await createHandler(testDeps({ push: f.push }))(scheduled as never);
    expect(f.expo.checkReceipts).not.toHaveBeenCalled();
    expect(report).toEqual({ checked: 0, pruned: 0, expired: 1, pending: 0 });
  });
});

describe("POST /devices/<id>/test", () => {
  it("sends a test notification to that one device", async () => {
    ddb.on(GetCommand, { Key: { pk: "DEVICE" } }).resolves({ Item: deviceRow("a", "expo") });
    const f = fakeProviders();
    const r = await caller({ push: f.push })(ev("POST", `/devices/${DEVICE_ID}/test`));
    expect(r).toMatchObject({ status: 200, body: { ok: true, sent: 1, failed: 0, pruned: 0 } });
    expect(f.expo.sent[0].devices.map((d) => d.id)).toEqual(["a"]);
    expect(f.expo.sent[0].msg.data).toEqual({ type: "test" });
  });

  it("reports a disabled provider as skipped rather than sent", async () => {
    ddb.on(GetCommand, { Key: { pk: "DEVICE" } }).resolves({ Item: deviceRow("b", "webpush") });
    const r = await caller()(ev("POST", `/devices/${DEVICE_ID}/test`));
    expect(r.body).toMatchObject({ ok: true, sent: 0, skipped: 1 });
  });

  it("returns 404 for an unknown device and 400 for a poller", async () => {
    expect((await caller()(ev("POST", `/devices/${DEVICE_ID}/test`))).status).toBe(404);
    ddb.on(GetCommand, { Key: { pk: "DEVICE" } }).resolves({ Item: deviceRow("c", "poll") });
    expect((await caller()(ev("POST", `/devices/${DEVICE_ID}/test`))).status).toBe(400);
  });
});

describe("GET /push/config", () => {
  it("tells clients which providers are on and the VAPID public key", async () => {
    const f = fakeProviders(fakeProvider("expo", false));
    const r = await caller({ push: f.push })(ev("GET", "/push/config"));
    expect(r.body).toEqual({ expo: { enabled: false }, webpush: { enabled: true, vapidPublicKey: "BPUBLICKEY" } });
  });

  it("requires the API key", async () => {
    expect((await caller()(ev("GET", "/push/config", { key: null }))).status).toBe(401);
  });
});
