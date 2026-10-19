// HTTP side of the Settings screen: GET/PUT /settings for the podcast
// section, and the Server section's connection test.
import { describe, expect, it } from "vitest";
import { createSettingsApi, effectiveServer, testConnection } from "../../src/settings/api";
import { DEFAULT_PODCAST } from "../../src/settings/store";
import { BASE, KEY, mockFetch } from "../notifications/helpers";

const remote = { notifications: { enabled: true }, podcast: { ...DEFAULT_PODCAST, time: "07:00" }, updatedAt: "2026-10-19T15:00:00.000Z" };

describe("settings api", () => {
  it("reads the podcast section and updatedAt from GET /settings, with the key", async () => {
    const m = mockFetch({ "GET /settings": () => [200, remote] });
    const api = createSettingsApi({ server: () => ({ baseUrl: BASE + "/", apiKey: KEY }), fetch: m.fetch });
    expect(await api.get()).toEqual({ podcast: remote.podcast, updatedAt: remote.updatedAt });
    expect(m.calls[0].url).toBe(`${BASE}/settings`);
    expect(m.calls[0].headers["x-api-key"]).toBe(KEY);
  });

  it("sends only the podcast section to PUT /settings", async () => {
    const m = mockFetch({ "PUT /settings": (c) => [200, { ...remote, podcast: c.body.podcast }] });
    const api = createSettingsApi({ server: () => ({ baseUrl: BASE, apiKey: KEY }), fetch: m.fetch });
    const out = await api.putPodcast({ ...DEFAULT_PODCAST, enabled: true });
    expect(m.calls[0].body).toEqual({ podcast: { ...DEFAULT_PODCAST, enabled: true } });
    expect(out.podcast.enabled).toBe(true);
  });

  it("reads the server at call time, so a new URL applies to the next request", async () => {
    const m = mockFetch({ "GET /settings": () => [200, remote] });
    let base = "http://old.test";
    const api = createSettingsApi({ server: () => ({ baseUrl: base, apiKey: KEY }), fetch: m.fetch });
    base = BASE;
    await api.get();
    expect(m.calls[0].url).toBe(`${BASE}/settings`);
  });

  it("fails without a network call when no server is set, and names the backend's error", async () => {
    const m = mockFetch({ "GET /settings": () => [400, { error: "podcast.time must be HH:MM (24-hour)" }] });
    const none = createSettingsApi({ server: () => ({ baseUrl: "", apiKey: "" }), fetch: m.fetch });
    await expect(none.get()).rejects.toThrow(/No server/);
    expect(m.calls).toHaveLength(0);
    const api = createSettingsApi({ server: () => ({ baseUrl: BASE, apiKey: KEY }), fetch: m.fetch });
    await expect(api.get()).rejects.toThrow("podcast.time must be HH:MM (24-hour)");
  });

  it("uses the build's server until this device overrides it", () => {
    const build = { baseUrl: "https://build.test", apiKey: "build-key" };
    expect(effectiveServer({ apiUrl: null, apiKey: null }, build)).toEqual(build);
    expect(effectiveServer({ apiUrl: " https://mine.test/ ", apiKey: "" }, build))
      .toEqual({ baseUrl: "https://mine.test", apiKey: "" });
  });
});

describe("connection test", () => {
  const clock = () => {
    let t = 1000;
    return () => (t += 71);
  };

  it("is connected when /health answers and the key opens /settings", async () => {
    const m = mockFetch({ "GET /health": () => [200, { ok: true }], "GET /settings": () => [200, remote] });
    const r = await testConnection({ baseUrl: BASE, apiKey: KEY }, { fetch: m.fetch, now: clock() });
    expect(r).toEqual({ state: "ok", ms: 71 });
    expect(m.calls.map((c) => c.url)).toEqual([`${BASE}/health`, `${BASE}/settings`]);
  });

  it("says the key was rejected when /health works but /settings answers 403", async () => {
    const m = mockFetch({ "GET /health": () => [200, { ok: true }], "GET /settings": () => [403, { error: "forbidden" }] });
    const r = await testConnection({ baseUrl: BASE, apiKey: "wrong" }, { fetch: m.fetch, now: clock() });
    expect(r).toEqual({ state: "bad-key", ms: 71 });
  });

  it("reports a server that does not answer /health", async () => {
    const m = mockFetch({ "GET /health": () => [502, {}] });
    const r = await testConnection({ baseUrl: BASE, apiKey: KEY }, { fetch: m.fetch, now: clock() });
    expect(r).toEqual({ state: "error", detail: "/health answered HTTP 502" });
    const down = await testConnection({ baseUrl: BASE, apiKey: KEY }, {
      fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch, now: clock(),
    });
    expect(down).toEqual({ state: "error", detail: "Failed to fetch" });
  });

  it("asks for a URL before calling anything", async () => {
    const m = mockFetch({});
    expect(await testConnection({ baseUrl: "", apiKey: KEY }, { fetch: m.fetch }))
      .toEqual({ state: "error", detail: "Enter the API URL first" });
    expect(m.calls).toHaveLength(0);
  });
});
