// public/sw.js is generated from sw/sw.ts. These tests run the shipped file
// itself in a vm sandbox with a fake service worker scope, and check that it
// still matches its TypeScript source.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { targetFromData, targetToQuery } from "../../src/notifications/target";

const APP = path.resolve(__dirname, "../..");
const SW_JS = readFileSync(path.join(APP, "public/sw.js"), "utf8");
const SCOPE = "https://app.test/";

function loadWorker(openWindows: Array<{ url: string }> = []) {
  const handlers: Record<string, (e: any) => void> = {};
  const clientsList = openWindows.map((w) => ({ ...w, focus: vi.fn(async () => undefined), postMessage: vi.fn() }));
  const self = {
    addEventListener: (type: string, fn: (e: any) => void) => void (handlers[type] = fn),
    skipWaiting: vi.fn(async () => undefined),
    registration: { scope: SCOPE, showNotification: vi.fn(async () => undefined) },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => clientsList),
      openWindow: vi.fn(async () => null),
    },
  };
  vm.runInNewContext(SW_JS, { self });
  async function fire(type: string, event: Record<string, unknown>) {
    let work: Promise<unknown> = Promise.resolve();
    handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  }
  return { self, clientsList, fire };
}

const pushOf = (payload: unknown) => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } });
const clickOf = (data: unknown) => ({ notification: { data, close: vi.fn() } });

describe("service worker", () => {
  it("matches a fresh build of sw/sw.ts", () => {
    const out = mkdtempSync(path.join(tmpdir(), "sw-"));
    execFileSync(process.execPath, [path.join(APP, "node_modules/typescript/bin/tsc"), "-p", path.join(APP, "sw"), "--outDir", out]);
    expect(readFileSync(path.join(out, "sw.js"), "utf8")).toBe(SW_JS);
  });

  it("shows each push and tells open windows about it", async () => {
    const w = loadWorker([{ url: SCOPE }]);
    const data = { type: "edition", id: "2026-10-19", path: "/editions/2026-10-19" };
    await w.fire("push", pushOf({ title: "Monday's edition", body: "5 stories", data }));
    expect(w.self.registration.showNotification).toHaveBeenCalledWith("Monday's edition", {
      body: "5 stories",
      data,
      tag: "edition-2026-10-19",
    });
    expect(w.clientsList[0].postMessage).toHaveBeenCalledWith({ type: "dd-push", data });
  });

  it("still shows something for a push with no payload", async () => {
    const w = loadWorker();
    await w.fire("push", { data: null });
    expect(w.self.registration.showNotification).toHaveBeenCalledWith("Daily Dispatch", { body: "", data: {}, tag: undefined });
  });

  it("on tap, focuses an open window and tells it what to open", async () => {
    const w = loadWorker([{ url: SCOPE + "?x=1" }]);
    const click = clickOf({ type: "episode", id: "ep-1" });
    await w.fire("notificationclick", click);
    expect(click.notification.close).toHaveBeenCalled();
    expect(w.clientsList[0].focus).toHaveBeenCalled();
    expect(w.clientsList[0].postMessage).toHaveBeenCalledWith({ type: "dd-open", data: { type: "episode", id: "ep-1" } });
    expect(w.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: "edition", id: "2026-10-19" }],
    [{ type: "episode", id: "ep-1" }],
    [{ path: "/editions/2026-10-18" }],
    [{ type: "test" }],
    [{ type: "edition", id: "../x" }],
    [null],
  ])("on tap with no window, opens the same URL the app parses (%j)", async (data) => {
    const w = loadWorker();
    await w.fire("notificationclick", clickOf(data));
    const t = targetFromData(data);
    expect(w.self.clients.openWindow).toHaveBeenCalledWith(SCOPE + (t ? targetToQuery(t) : ""));
  });
});
