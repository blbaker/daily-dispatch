import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { caller, ev } from "./helpers";
import { deviceRow } from "./fakes";

const ddb = mockClient(DynamoDBDocumentClient);
const call = caller();

function row(createdAt: string, event: "edition" | "episode", refId: string) {
  return {
    pk: "NOTIFICATION",
    sk: `${createdAt}#${event}#${refId}`,
    id: `${event}#${refId}`,
    event,
    refId,
    title: "t",
    body: "b",
    data: { type: event, id: refId },
    createdAt,
  };
}

const E1 = row("2026-10-19T11:00:00.000Z", "episode", "ep-1");
const E2 = row("2026-10-19T22:00:00.000Z", "edition", "2026-10-19");

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [E1, E2] });
});

const query = () => ddb.commandCalls(QueryCommand)[0].args[0].input;

describe("GET /notifications/since", () => {
  it("returns notifications after the given time, oldest first, with a cursor", async () => {
    const r = await call(ev("GET", "/notifications/since", { query: { ts: "2026-10-19T00:00:00.000Z" } }));
    expect(r.status).toBe(200);
    expect(r.body.notifications.map((n: { id: string }) => n.id)).toEqual(["episode#ep-1", "edition#2026-10-19"]);
    expect(r.body.notifications[0]).toEqual({
      id: "episode#ep-1", event: "episode", refId: "ep-1", title: "t", body: "b",
      data: { type: "episode", id: "ep-1" }, createdAt: "2026-10-19T11:00:00.000Z",
    });
    expect(r.body.cursor).toBe("2026-10-19T22:00:00.000Z");
    expect(query()).toMatchObject({
      KeyConditionExpression: "pk = :p AND sk > :s",
      ExpressionAttributeValues: { ":p": "NOTIFICATION", ":s": "2026-10-19T00:00:00.000Z#~" },
      ScanIndexForward: true,
      Limit: 50,
    });
  });

  it("accepts epoch milliseconds", async () => {
    await call(ev("GET", "/notifications/since", { query: { ts: String(Date.parse("2026-10-19T00:00:00.000Z")) } }));
    expect(query().ExpressionAttributeValues![":s"]).toBe("2026-10-19T00:00:00.000Z#~");
  });

  it("keeps the given time as the cursor when nothing is new", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    const r = await call(ev("GET", "/notifications/since", { query: { ts: "2026-10-19T23:00:00.000Z" } }));
    expect(r.body).toEqual({ notifications: [], cursor: "2026-10-19T23:00:00.000Z" });
  });

  it.each([[{}], [{ ts: "yesterday" }], [{ ts: "2026-10-19T00:00:00Z", limit: "0" }]])("rejects %j", async (q) => {
    expect((await call(ev("GET", "/notifications/since", { query: q }))).status).toBe(400);
  });

  it("filters by the polling device's prefs but still advances the cursor past filtered rows", async () => {
    ddb.on(GetCommand, { Key: { pk: "DEVICE" } }).resolves({ Item: deviceRow("d1", "poll", { newEdition: false }) });
    const r = await call(
      ev("GET", "/notifications/since", { query: { ts: "2026-10-19T00:00:00.000Z", device: "0123456789abcdef01234567" } }),
    );
    expect(r.body.notifications.map((n: { id: string }) => n.id)).toEqual(["episode#ep-1"]);
    expect(r.body.cursor).toBe("2026-10-19T22:00:00.000Z");
  });

  it("returns nothing when the master switch is off", async () => {
    ddb.on(GetCommand, { Key: { pk: "SETTINGS" } }).resolves({ Item: { notifications: { enabled: false } } });
    const r = await call(ev("GET", "/notifications/since", { query: { ts: "2026-10-19T00:00:00.000Z" } }));
    expect(r.body.notifications).toEqual([]);
  });

  it("returns 404 for an unknown device so the poller registers again", async () => {
    const r = await call(
      ev("GET", "/notifications/since", { query: { ts: "2026-10-19T00:00:00.000Z", device: "0123456789abcdef01234567" } }),
    );
    expect(r.status).toBe(404);
  });

  it("requires the API key", async () => {
    expect((await call(ev("GET", "/notifications/since", { key: null, query: { ts: "0" } }))).status).toBe(401);
  });
});
