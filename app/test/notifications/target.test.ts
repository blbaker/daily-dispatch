import { describe, expect, it } from "vitest";
import { channelFor } from "../../src/notifications/select";
import { targetFromData, targetFromQuery, targetToQuery } from "../../src/notifications/target";

describe("channelFor", () => {
  it("uses Expo push on iOS and Android", () => {
    expect(channelFor("ios")).toBe("expo");
    expect(channelFor("android")).toBe("expo");
  });

  it("uses Web Push in the browser", () => {
    expect(channelFor("web")).toBe("webpush");
  });

  it("polls on Impeller and any other desktop platform", () => {
    for (const os of ["impeller", "macos", "windows", "linux"]) expect(channelFor(os)).toBe("poll");
  });
});

describe("targetFromData", () => {
  it("reads type and id from a push payload", () => {
    expect(targetFromData({ type: "edition", id: "2026-10-19", path: "/editions/2026-10-19" })).toEqual({
      kind: "edition",
      id: "2026-10-19",
    });
    expect(targetFromData({ type: "episode", id: "2026-10-19" })).toEqual({ kind: "episode", id: "2026-10-19" });
  });

  it("falls back to the API path when type or id is missing", () => {
    expect(targetFromData({ path: "/episodes/ep-7" })).toEqual({ kind: "episode", id: "ep-7" });
  });

  it("returns null for test pushes and junk", () => {
    expect(targetFromData({ type: "test" })).toBeNull();
    expect(targetFromData(null)).toBeNull();
    expect(targetFromData("edition")).toBeNull();
    expect(targetFromData({ type: "edition", id: "../../etc" })).toBeNull();
    expect(targetFromData({ path: "/editions/a/b" })).toBeNull();
  });
});

describe("query round trip", () => {
  it("encodes a target as a query string and reads it back", () => {
    const q = targetToQuery({ kind: "edition", id: "2026-10-19" });
    expect(q).toBe("?edition=2026-10-19");
    expect(targetFromQuery(q)).toEqual({ kind: "edition", id: "2026-10-19" });
    expect(targetFromQuery("?episode=ep-1&x=1")).toEqual({ kind: "episode", id: "ep-1" });
  });

  it("ignores unrelated or unsafe query strings", () => {
    expect(targetFromQuery("")).toBeNull();
    expect(targetFromQuery("?updateDemo=ready")).toBeNull();
    expect(targetFromQuery("?edition=<script>")).toBeNull();
  });
});
