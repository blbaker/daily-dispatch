// End-to-end check of the Settings screen in a web export, against the mock
// backend. Every section is driven through the real UI:
//
//   node e2e/settings-flow.ts <dist dir> <api port>
//
// Notifications reach PUT /settings through the task 6 module; Daily podcast
// edits reach the backend's podcast section; Reading survives a reload;
// an edit made while the backend is down is sent after it comes back; a
// newer edit made on the backend wins; Server tests /health and the key;
// About shows the version, licenses and the source link.
import { chromium, type Page } from "playwright";
import { MOCK_API_KEY, startMockBackend } from "./mock-backend.ts";
import { serveStatic } from "./static-server.ts";

const [distDir, apiPort] = process.argv.slice(2);
if (!distDir || !apiPort) {
  console.error("usage: node e2e/settings-flow.ts <dist dir> <api port>");
  process.exit(2);
}

let failures = 0;
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

async function until(fn: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fn();
}

async function openSettings(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("settings-screen").waitFor();
}

async function pick(page: Page, row: string, option: string): Promise<void> {
  await page.getByTestId(row).click();
  await page.getByTestId("settings-sheet").getByText(option, { exact: true }).click();
  await page.getByTestId("settings-sheet").waitFor({ state: "detached" });
}

const text = (page: Page, id: string) => page.getByTestId(id).innerText();

async function main(): Promise<void> {
  const backend = await startMockBackend(Number(apiPort));
  const podcast = () => backend.state.settings.podcast as Record<string, unknown>;
  const site = await serveStatic(distDir);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("https://github.com/**", (r) => r.fulfill({ status: 200, body: "source" }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await openSettings(page, site.url);

    // Server: the section tests the saved server on open.
    await page.getByText("Connected", { exact: true }).waitFor();
    check(backend.state.requests.some((r) => r.path === "/health"), "Server: opening Settings tests GET /health");

    // Notifications: the task 6 prefs reach PUT /settings.
    await page.getByTestId("notif-episode").click();
    check(await until(() => backend.state.settings.notifications.newEpisode === false),
      "Notifications: New episode off reaches PUT /settings");

    // Daily podcast: every control writes the backend's podcast section.
    await page.getByTestId("podcast-enabled").click();
    check(await until(() => podcast().enabled === true), "Podcast: enabling reaches the backend");
    await pick(page, "podcast-time", "7:30 AM");
    check(await until(() => podcast().time === "07:30"), "Podcast: time 7:30 AM saved as 07:30");
    await pick(page, "podcast-tz", "America/Chicago");
    check(await until(() => podcast().timezone === "America/Chicago"), "Podcast: time zone saved");
    await pick(page, "podcast-writer", "Ollama");
    check(await until(() => podcast().scriptWriter === "ollama"), "Podcast: script writer saved");
    await pick(page, "podcast-voice", "OpenAI");
    check(await until(() => podcast().voiceProvider === "openai"), "Podcast: voice provider saved");
    await pick(page, "podcast-host1", "nova");
    await pick(page, "podcast-host2", "onyx");
    check(await until(() => JSON.stringify(podcast().hostVoices) === JSON.stringify({ "Host 1": "nova", "Host 2": "onyx" })),
      "Podcast: host voices saved in speaker order", JSON.stringify(podcast().hostVoices));
    check((await text(page, "settings-sync")).startsWith("Saved · synced"), "Header says the change is synced");

    // Reading: text size redraws the preview row and survives a reload.
    const size = () => page.getByTestId("text-size-preview").getByText(/^Webb finds/).evaluate((el) => getComputedStyle(el).fontSize);
    const before = await size();
    await page.getByTestId("text-size-larger").click();
    await page.waitForTimeout(200);
    check((await size()) === "20px", "Reading: Larger draws the 16px headline at 20px", `${before} -> ${await size()}`);
    await page.getByTestId("eink-mode").click();
    const ink = await page.getByText("Test connection").evaluate((el) => getComputedStyle(el).color);
    check(ink === "rgb(0, 0, 0)", "Reading: e-ink mode turns the accent black", ink);
    await page.getByTestId("eink-mode").click();

    await openSettings(page, site.url); // restart
    await page.getByTestId("text-size-preview").waitFor();
    check((await size()) === "20px", "Restart: text size is still Larger", await size());
    check((await page.getByTestId("podcast-time").innerText()).includes("7:30"), "Restart: podcast time is still 7:30");

    // Offline: the edit stays on the device and goes out when the backend is back.
    backend.state.failAll = true;
    await pick(page, "podcast-time", "8:00 AM");
    const offlineLine = await page.getByTestId("settings-sync").getByText(/will sync/)
      .waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(offlineLine, "Offline: header says the edit will sync later", await text(page, "settings-sync"));
    check(podcast().time === "07:30", "Offline: backend still has 07:30");
    backend.state.failAll = false;
    await openSettings(page, site.url); // the app comes back with the server up
    check(await until(() => podcast().time === "08:00"), "Back online: the offline edit reached the backend");

    // Conflict: a newer edit made on the backend wins over this device's copy.
    backend.state.settings.podcast = { ...podcast(), time: "09:00" };
    backend.state.settings.updatedAt = new Date(Date.now() + 1000).toISOString();
    await openSettings(page, site.url);
    await page.getByTestId("podcast-time").getByText(/^9:00/).waitFor({ timeout: 8000 }).catch(() => undefined);
    check((await page.getByTestId("podcast-time").innerText()).includes("9:00"), "Conflict: the backend's newer 9:00 shows here");

    // Server: a wrong key is caught by the test; the right one connects.
    await page.getByTestId("server-key").fill("wrong-key");
    await page.getByTestId("server-test").click();
    await page.getByText("Key rejected", { exact: true }).waitFor().catch(() => undefined);
    check(await page.getByText("Key rejected", { exact: true }).isVisible(), "Server: a wrong key is reported");
    await page.getByTestId("server-key").fill(MOCK_API_KEY);
    await page.getByTestId("server-test").click();
    await page.getByText("Connected", { exact: true }).waitFor().catch(() => undefined);
    check(await page.getByText("Connected", { exact: true }).isVisible(), "Server: the right key connects again");

    // About: version, licenses, source link.
    check(await page.getByText("1.0.209", { exact: true }).isVisible(), "About: version from app.json");
    await page.getByTestId("licenses").click();
    const sheet = await page.getByTestId("settings-sheet").innerText();
    check(sheet.includes("react-native") && sheet.includes("MIT"), "About: licenses list the dependencies");
    await page.getByTestId("settings-sheet").getByText("Done").click();
    const popup = context.waitForEvent("page", { timeout: 5000 });
    await page.getByText("Source code").click();
    const src = await popup.then((p) => p.url()).catch(() => "");
    check(src === "https://github.com/blbaker/daily-dispatch", "About: Source code opens the repo", src);

    check(errors.length === 0, "No page errors", errors.join(" | ").slice(0, 300));
  } finally {
    await browser.close();
    await site.close();
    await backend.close();
  }
  console.log(failures === 0 ? "SETTINGS_FLOW_PASS" : `SETTINGS_FLOW_FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
