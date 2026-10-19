import { describe, expect, it, vi } from "vitest";
import { liveProviders } from "../lambda/push/registry";

describe("liveProviders", () => {
  const opts = (load: () => Promise<Record<string, string>>, now: () => number) => ({
    fetch: vi.fn() as never,
    log: vi.fn(),
    load,
    now,
  });

  it("loads credentials once and reuses them within 15 minutes", async () => {
    const load = vi.fn(async () => ({ EXPO_ACCESS_TOKEN: "t" }));
    let t = 0;
    const get = liveProviders(opts(load, () => t));
    await get();
    t = 14 * 60_000;
    expect((await get()).expo.enabled).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after 15 minutes, so a parameter added after a cold start takes effect without a deploy", async () => {
    const load = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ EXPO_ACCESS_TOKEN: "t" });
    let t = 0;
    const get = liveProviders(opts(load, () => t));
    expect((await get()).expo.enabled).toBe(false);
    t = 15 * 60_000 + 1;
    expect((await get()).expo.enabled).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
