import { describe, expect, it } from "vitest";
import { PushApiError, createPushApi } from "../../src/notifications/api";
import { BASE, KEY, mockFetch } from "./helpers";

describe("createPushApi", () => {
  it("posts a registration with the API key and returns the device id", async () => {
    const m = mockFetch({ "POST /devices": () => [200, { device: { id: "a".repeat(24) } }] });
    const api = createPushApi({ baseUrl: BASE + "/", apiKey: KEY, fetch: m.fetch });
    const id = await api.registerDevice({ platform: "android", kind: "expo", token: "ExponentPushToken[x]" });
    expect(id).toBe("a".repeat(24));
    expect(m.calls[0]).toMatchObject({
      method: "POST",
      url: `${BASE}/devices`,
      headers: { "x-api-key": KEY, "content-type": "application/json" },
      body: { platform: "android", kind: "expo", token: "ExponentPushToken[x]" },
    });
  });

  it("turns an error reply into a PushApiError with the status and message", async () => {
    const m = mockFetch({ "PUT /settings": () => [400, { error: "notifications.enabled must be true or false" }] });
    const api = createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch });
    const err = await api.putSettings({ enabled: true }).catch((e) => e);
    expect(err).toBeInstanceOf(PushApiError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("notifications.enabled");
    expect(m.calls[0].body).toEqual({ notifications: { enabled: true } });
  });

  it("asks for notifications since a cursor for one device", async () => {
    const m = mockFetch({ "GET /notifications/since": () => [200, { notifications: [], cursor: "c1" }] });
    const api = createPushApi({ baseUrl: BASE, apiKey: KEY, fetch: m.fetch });
    const page = await api.notificationsSince("2026-10-19T00:00:00.000Z", "dev1");
    expect(page.cursor).toBe("c1");
    const url = new URL(m.calls[0].url);
    expect(url.searchParams.get("ts")).toBe("2026-10-19T00:00:00.000Z");
    expect(url.searchParams.get("device")).toBe("dev1");
  });

  it("reads the base URL and key at call time when given functions", async () => {
    const m = mockFetch({ "PUT /settings": () => [200, {}] });
    const server = { baseUrl: "", apiKey: "" };
    const api = createPushApi({ baseUrl: () => server.baseUrl, apiKey: () => server.apiKey, fetch: m.fetch });
    expect(api.configured).toBe(false);
    server.baseUrl = BASE;
    server.apiKey = KEY;
    expect(api.configured).toBe(true);
    await api.putSettings({ enabled: false });
    expect(m.calls[0].url).toBe(`${BASE}/settings`);
    expect(m.calls[0].headers["x-api-key"]).toBe(KEY);
  });

  it("reports itself unconfigured without a base URL or key", () => {
    expect(createPushApi({ baseUrl: "", apiKey: KEY }).configured).toBe(false);
    expect(createPushApi({ baseUrl: BASE, apiKey: "" }).configured).toBe(false);
    expect(createPushApi({ baseUrl: BASE, apiKey: KEY }).configured).toBe(true);
  });
});
