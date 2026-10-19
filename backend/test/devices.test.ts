import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { caller, ev } from "./helpers";

const ddb = mockClient(DynamoDBDocumentClient);
const call = caller();

const EXPO = { platform: "android", kind: "expo", token: "ExponentPushToken[abc123]" };
const SUB = {
  endpoint: "https://push.example.test/send/xyz",
  expirationTime: null,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
};

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand).resolves({});
  ddb.on(PutCommand).resolves({});
});

const putItem = () => ddb.commandCalls(PutCommand)[0].args[0].input.Item!;

describe("POST /devices", () => {
  it("registers an Expo token with default prefs and hides the token in the reply", async () => {
    const r = await call(ev("POST", "/devices", { body: EXPO }));
    expect(r.status).toBe(200);
    expect(r.body.device).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      platform: "android",
      kind: "expo",
      prefs: { enabled: true, newEdition: true, newEpisode: true },
      createdAt: "2026-10-19T22:00:00.000Z",
      updatedAt: "2026-10-19T22:00:00.000Z",
    });
    expect(putItem()).toMatchObject({ pk: "DEVICE", sk: r.body.device.id, token: EXPO.token });
  });

  it("derives the same id from the same token so re-registering upserts", async () => {
    const a = await call(ev("POST", "/devices", { body: EXPO }));
    const b = await call(ev("POST", "/devices", { body: { ...EXPO, platform: "ios" } }));
    expect(a.body.device.id).toBe(b.body.device.id);
  });

  it("keeps createdAt and prefs when an existing device registers again without prefs", async () => {
    ddb.on(GetCommand).resolves({
      Item: { pk: "DEVICE", sk: "x", createdAt: "2026-01-01T00:00:00.000Z", prefs: { enabled: true, newEdition: false, newEpisode: true } },
    });
    const r = await call(ev("POST", "/devices", { body: EXPO }));
    expect(r.body.device.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(r.body.device.prefs.newEdition).toBe(false);
  });

  it("merges partial prefs over the stored ones", async () => {
    ddb.on(GetCommand).resolves({ Item: { prefs: { enabled: true, newEdition: false, newEpisode: true } } });
    const r = await call(ev("POST", "/devices", { body: { ...EXPO, prefs: { newEpisode: false } } }));
    expect(r.body.device.prefs).toEqual({ enabled: true, newEdition: false, newEpisode: false });
  });

  it("registers a Web Push subscription", async () => {
    const r = await call(ev("POST", "/devices", { body: { platform: "web", kind: "webpush", subscription: SUB } }));
    expect(r.status).toBe(200);
    expect(putItem()).toMatchObject({ kind: "webpush", subscription: SUB });
  });

  it("registers a desktop poller by its install id", async () => {
    const r = await call(ev("POST", "/devices", { body: { platform: "desktop", kind: "poll", token: "install-3f9a1c" } }));
    expect(r.status).toBe(200);
    expect(putItem()).toMatchObject({ kind: "poll", token: "install-3f9a1c" });
  });

  it.each([
    [{ ...EXPO, platform: "symbian" }, "platform"],
    [{ ...EXPO, kind: "sms" }, "kind"],
    [{ ...EXPO, platform: "web" }, "platform"],
    [{ ...EXPO, token: "not-a-token" }, "token"],
    [{ platform: "web", kind: "webpush", subscription: { endpoint: SUB.endpoint } }, "subscription"],
    [{ platform: "web", kind: "webpush", subscription: { ...SUB, endpoint: "http://push.example.test/x" } }, "subscription"],
    [{ platform: "desktop", kind: "poll" }, "token"],
    [{ ...EXPO, prefs: { newEdition: "no" } }, "prefs.newEdition"],
    [{ ...EXPO, prefs: { vibrate: true } }, "prefs.vibrate"],
  ])("rejects %j naming %s", async (body, field) => {
    const r = await call(ev("POST", "/devices", { body }));
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(field);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe("DELETE /devices/<id>", () => {
  const id = "0123456789abcdef01234567";

  it("removes the device row", async () => {
    ddb.on(DeleteCommand).resolves({ Attributes: { pk: "DEVICE", sk: id } });
    const r = await call(ev("DELETE", `/devices/${id}`));
    expect(r).toEqual({ status: 200, body: { ok: true, removed: true } });
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ pk: "DEVICE", sk: id });
  });

  it("reports removed:false for an unknown id instead of failing", async () => {
    ddb.on(DeleteCommand).resolves({});
    expect((await call(ev("DELETE", `/devices/${id}`))).body).toEqual({ ok: true, removed: false });
  });

  it("requires the API key", async () => {
    expect((await call(ev("DELETE", `/devices/${id}`, { key: null }))).status).toBe(401);
  });
});
