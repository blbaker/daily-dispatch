import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { caller, ev } from "./helpers";
import { deviceRow, fakeProviders } from "./fakes";

const ddb = mockClient(DynamoDBDocumentClient);

const TODAY = "2026-10-19";
const stories = [{ headline: "Lead story" }, { headline: "Second" }, { headline: "Third" }];
const finished = (id = TODAY) => ev("POST", "/editions", { body: { id, stories } });

function stubDevices(rows: object[]) {
  ddb.on(QueryCommand, { ExpressionAttributeValues: { ":p": "DEVICE" } }).resolves({ Items: rows });
}

const puts = (pk: string) =>
  ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.Item?.pk === pk);

beforeEach(() => {
  ddb.reset();
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(PutCommand).resolves({});
  ddb.on(GetCommand).resolves({});
  ddb.on(BatchWriteCommand).resolves({});
  ddb.on(DeleteCommand).resolves({ Attributes: {} });
});

describe("publishing a finished edition", () => {
  it("records one notification and sends it to every expo and webpush device", async () => {
    const f = fakeProviders();
    stubDevices([deviceRow("a", "expo"), deviceRow("b", "webpush"), deviceRow("c", "poll")]);
    const r = await caller({ push: f.push })(finished());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, stories: 3, push: { recorded: true, sent: 2, failed: 0, pruned: 0 } });

    const marker = puts("NOTIFIED")[0];
    expect(marker).toMatchObject({ Item: { sk: `edition#${TODAY}` }, ConditionExpression: "attribute_not_exists(pk)" });
    const rec = puts("NOTIFICATION")[0].Item!;
    expect(rec).toMatchObject({ sk: `2026-10-19T22:00:00.000Z#edition#${TODAY}`, event: "edition", refId: TODAY });

    expect(f.expo.sent[0].devices.map((d) => d.id)).toEqual(["a"]);
    expect(f.webpush.sent[0].devices.map((d) => d.id)).toEqual(["b"]);
    expect(f.expo.sent[0].msg).toEqual({
      title: "New edition ready",
      body: "Lead story + 2 more stories",
      data: { type: "edition", id: TODAY, path: `/editions/${TODAY}` },
    });
  });

  it("does nothing for an in-progress edition and keeps the old reply shape", async () => {
    const f = fakeProviders();
    stubDevices([deviceRow("a", "expo")]);
    const r = await caller({ push: f.push })(ev("POST", "/editions", { body: { id: TODAY, stories, inProgress: true } }));
    expect(r.body).toEqual({ ok: true, date: TODAY, stories: 3, removed: 0 });
    expect(puts("NOTIFIED")).toHaveLength(0);
    expect(f.expo.sent).toHaveLength(0);
  });

  it("does not notify for an old edition, so a full history re-push stays silent", async () => {
    const f = fakeProviders();
    stubDevices([deviceRow("a", "expo")]);
    const r = await caller({ push: f.push })(finished("2026-10-01"));
    expect(r.body.push).toEqual({ recorded: false, reason: "old-edition" });
    expect(f.expo.sent).toHaveLength(0);
  });

  it("still notifies for yesterday's edition (a late finish past midnight UTC)", async () => {
    const f = fakeProviders();
    stubDevices([deviceRow("a", "expo")]);
    const r = await caller({ push: f.push })(finished("2026-10-18"));
    expect(r.body.push.recorded).toBe(true);
  });

  it("sends only once when the same edition is posted again", async () => {
    const f = fakeProviders();
    stubDevices([deviceRow("a", "expo")]);
    ddb
      .on(PutCommand, { Item: { pk: "NOTIFIED" } })
      .rejects(new ConditionalCheckFailedException({ message: "exists", $metadata: {} }));
    const r = await caller({ push: f.push })(finished());
    expect(r.body.push).toEqual({ recorded: false, reason: "already-notified" });
    expect(f.expo.sent).toHaveLength(0);
  });

  it("skips devices whose prefs exclude new editions, and everyone when the master switch is off", async () => {
    const f = fakeProviders();
    stubDevices([
      deviceRow("a", "expo"),
      deviceRow("b", "expo", { newEdition: false }),
      deviceRow("c", "webpush", { enabled: false }),
      deviceRow("d", "webpush", { newEpisode: false }),
    ]);
    await caller({ push: f.push })(finished());
    expect(f.expo.sent[0].devices.map((d) => d.id)).toEqual(["a"]);
    expect(f.webpush.sent[0].devices.map((d) => d.id)).toEqual(["d"]);

    ddb.on(GetCommand, { Key: { pk: "SETTINGS" } }).resolves({ Item: { notifications: { enabled: false } } });
    const g = fakeProviders();
    const r = await caller({ push: g.push })(finished());
    expect(r.body.push).toMatchObject({ recorded: true, sent: 0 });
    expect(g.expo.sent).toHaveLength(0);
    expect(g.webpush.sent).toHaveLength(0);
  });

  it("deletes devices the push service reports as gone", async () => {
    const f = fakeProviders();
    f.expo.gone.add("b");
    f.webpush.gone.add("c");
    stubDevices([deviceRow("a", "expo"), deviceRow("b", "expo"), deviceRow("c", "webpush")]);
    const r = await caller({ push: f.push })(finished());
    expect(r.body.push).toMatchObject({ sent: 1, failed: 2, pruned: 2 });
    const deleted = ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key);
    expect(deleted).toEqual([{ pk: "DEVICE", sk: "b" }, { pk: "DEVICE", sk: "c" }]);
  });

  it("stores expo tickets so the receipt check can find dead tokens later", async () => {
    const f = fakeProviders();
    stubDevices([deviceRow("a", "expo")]);
    await caller({ push: f.push })(finished());
    const writes = ddb.commandCalls(BatchWriteCommand).flatMap((c) => c.args[0].input.RequestItems!["test-table"]);
    const receipts = writes.map((w) => w.PutRequest?.Item).filter((i) => i?.pk === "RECEIPT");
    expect(receipts).toEqual([{ pk: "RECEIPT", sk: "ticket-a", deviceId: "a", sentAt: "2026-10-19T22:00:00.000Z" }]);
  });

  it("keeps the edition write when fan-out fails", async () => {
    const f = fakeProviders();
    ddb.on(QueryCommand, { ExpressionAttributeValues: { ":p": "DEVICE" } }).rejects(new Error("throttled"));
    const r = await caller({ push: f.push })(finished());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, push: { recorded: true, error: "throttled" } });
  });
});
