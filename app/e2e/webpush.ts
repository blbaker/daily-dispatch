// Web Push end to end in headless Chromium, against the mock backend:
//   1. the app registers its service worker and subscribes with the
//      server's VAPID key, then POSTs the subscription to /devices;
//   2. a push is delivered to the service worker (DevTools'
//      ServiceWorker.deliverPushMessage, the same path as the Push button
//      in DevTools) and the worker shows a notification;
//   3. the app handles the two ways a tap reaches it: a message to an open
//      window, and a new window opened at ?edition=<id>.
//
//   node e2e/webpush.ts <dist dir> <out dir> <api port>
//
// Notifications and Push need a regular (not incognito) profile and the new
// headless mode, hence launchPersistentContext with channel "chromium".
// Creating the subscription contacts the browser's push service.
import { createECDH } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { startMockBackend } from "./mock-backend.ts";
import { serveStatic } from "./static-server.ts";

const [distDir, outDir, apiPort] = process.argv.slice(2);
if (!distDir || !outDir || !apiPort) {
  console.error("usage: node e2e/webpush.ts <dist dir> <out dir> <api port>");
  process.exit(2);
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) process.exitCode = 1;
}

async function until<T>(fn: () => T | Promise<T>, ms = 20000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const PUSH = {
  title: "Wednesday's edition is ready",
  body: "2 stories, led by a study that tracks sleep across four seasons.",
  data: { type: "edition", id: "2026-03-11", path: "/editions/2026-03-11" },
};

async function heroDate(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const backend = await startMockBackend(Number(apiPort), ecdh.getPublicKey().toString("base64url"));
  const site = await serveStatic(distDir);
  const profile = await mkdtemp(path.join(tmpdir(), "dd-webpush-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const report: Record<string, unknown> = {};
  try {
    await context.grantPermissions(["notifications"], { origin: site.url });
    const page = context.pages()[0] ?? (await context.newPage());
    page.on("console", (m) => m.type() === "error" && console.log(`  page console: ${m.text().slice(0, 200)}`));
    page.on("pageerror", (e) => console.log(`  page error: ${String(e).slice(0, 200)}`));
    await page.goto(site.url);
    await page.getByText("March 12").first().waitFor();

    // 1. subscription created and registered
    // Subscribing waits on the browser's push service; give it time.
    const device = await until(() => [...backend.state.devices.values()].find((d) => d.kind === "webpush"), 90000);
    const sub = device.subscription as { endpoint: string; keys: Record<string, string> };
    check(device.platform === "web", "POST /devices registered a web device");
    check(sub.endpoint.startsWith("https://") && !!sub.keys?.p256dh && !!sub.keys?.auth, "it carries a PushSubscription");
    report.endpointHost = new URL(sub.endpoint).host;
    report.deviceId = device.id;

    // 2. deliver a push to the service worker; it must show a notification
    const cdp = await context.newCDPSession(page);
    const regs: Array<{ registrationId: string; scopeURL: string; isDeleted: boolean }> = [];
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
    await cdp.send("ServiceWorker.enable");
    cdp.on("ServiceWorker.workerErrorReported", (e) => console.log(`  worker error: ${e.errorMessage.errorMessage}`));
    const reg = await until(() => regs.find((r) => !r.isDeleted && r.scopeURL.startsWith(site.url)));
    // Without the two pauses around the delivery, the getNotifications() check
    // timed out in 3 of 3 runs even though the worker had shown it; with them
    // it passed 3 of 3. The cause was not found.
    await page.waitForTimeout(1000);
    const listsBefore = backend.state.requests.filter((r) => r.path === "/editions").length;
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: site.url,
      registrationId: reg.registrationId,
      data: JSON.stringify(PUSH),
    });
    await page.waitForTimeout(2000);
    const shown = await until(() =>
      page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        const list = await r.getNotifications();
        return list.length ? list.map((n) => ({ title: n.title, body: n.body, data: n.data, tag: n.tag })) : null;
      }),
    );
    check(shown[0]?.title === PUSH.title && shown[0]?.body === PUSH.body, "the worker showed the pushed notification");
    report.notifications = shown;
    await until(() => backend.state.requests.filter((r) => r.path === "/editions").length > listsBefore);
    check(true, "the open app refreshed its edition list when the push arrived");
    await page.screenshot({ path: path.join(outDir, "webpush-received.png") });

    // 3a. tap with the app open: the worker focuses it and posts dd-open
    const [worker] = context.serviceWorkers();
    await worker.evaluate(async (data) => {
      const scope = self as unknown as { clients: { matchAll(o: object): Promise<Array<{ postMessage(m: unknown): void }>> } };
      for (const c of await scope.clients.matchAll({ type: "window" })) c.postMessage({ type: "dd-open", data });
    }, PUSH.data);
    await until(async () => (await heroDate(page)).includes("March 11"));
    check((await heroDate(page)).includes("2 stories"), "dd-open message opened the March 11 edition");
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, "webpush-open.png") });

    // 3b. tap with no window: the worker opens <scope>?edition=<id>
    const cold = await context.newPage();
    await cold.goto(`${site.url}/?edition=2026-03-11`);
    await until(async () => (await heroDate(cold)).includes("March 11"));
    check(new URL(cold.url()).search === "", "?edition= opened March 11 and was cleared from the address bar");

    await writeFile(path.join(outDir, "webpush-report.json"), JSON.stringify(report, null, 2));
    console.log(`report: ${path.join(outDir, "webpush-report.json")}`);
  } finally {
    await context.close();
    await site.close();
    await backend.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
