import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { caller, ev } from "./helpers";

const ddb = mockClient(DynamoDBDocumentClient);
const call = caller();

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand).resolves({});
  ddb.on(PutCommand).resolves({});
});

const DEFAULTS = {
  notifications: { enabled: true, newEdition: true, newEpisode: true },
  podcast: {
    enabled: false,
    time: "06:00",
    timezone: "UTC",
    voiceProvider: "elevenlabs",
    scriptWriter: "command",
    hostVoices: {},
  },
  updatedAt: null,
};

describe("GET /settings", () => {
  it("returns defaults when nothing is stored, with the daily episode off", async () => {
    const r = await call(ev("GET", "/settings"));
    expect(r).toEqual({ status: 200, body: DEFAULTS });
    expect(ddb.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({ pk: "SETTINGS", sk: "CURRENT" });
  });

  it("fills fields missing from an older stored row with defaults", async () => {
    ddb.on(GetCommand).resolves({
      Item: { pk: "SETTINGS", sk: "CURRENT", notifications: { newEpisode: false }, updatedAt: "2026-10-01T00:00:00.000Z" },
    });
    const r = await call(ev("GET", "/settings"));
    expect(r.body.notifications).toEqual({ enabled: true, newEdition: true, newEpisode: false });
    expect(r.body.podcast).toEqual(DEFAULTS.podcast);
    expect(r.body.updatedAt).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("PUT /settings", () => {
  it("merges a partial update and stores the result", async () => {
    const r = await call(
      ev("PUT", "/settings", {
        body: {
          notifications: { newEpisode: false },
          podcast: { enabled: true, time: "07:30", timezone: "America/Chicago", hostVoices: { Alex: "voice-a" } },
        },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.body.notifications).toEqual({ enabled: true, newEdition: true, newEpisode: false });
    expect(r.body.podcast).toMatchObject({ enabled: true, time: "07:30", timezone: "America/Chicago", voiceProvider: "elevenlabs" });
    expect(r.body.updatedAt).toBe("2026-10-19T22:00:00.000Z");
    const item = ddb.commandCalls(PutCommand)[0].args[0].input.Item;
    expect(item).toMatchObject({ pk: "SETTINGS", sk: "CURRENT", podcast: { hostVoices: { Alex: "voice-a" } } });
  });

  it.each([
    [{ podcast: { time: "7:30" } }, "podcast.time"],
    [{ podcast: { time: "24:00" } }, "podcast.time"],
    [{ podcast: { timezone: "Mars/Olympus_Mons" } }, "podcast.timezone"],
    [{ podcast: { voiceProvider: "Eleven Labs!" } }, "podcast.voiceProvider"],
    [{ podcast: { hostVoices: { Alex: 3 } } }, "podcast.hostVoices"],
    [{ notifications: { enabled: "yes" } }, "notifications.enabled"],
    [{ notifications: { sound: true } }, "notifications.sound"],
    [{ reading: { textSize: 2 } }, "reading"],
    [{ podcast: "on" }, "podcast"],
  ])("rejects %j naming %s", async (body, field) => {
    const r = await call(ev("PUT", "/settings", { body }));
    expect(r.status).toBe(400);
    expect(r.body.error).toContain(field);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("rejects a body that is not JSON", async () => {
    const r = await call(ev("PUT", "/settings", { body: "{not json" }));
    expect(r).toEqual({ status: 400, body: { error: "body is not valid JSON" } });
  });

  it("requires the API key", async () => {
    expect((await call(ev("PUT", "/settings", { key: null, body: {} }))).status).toBe(401);
  });
});
