// Screenshots of the main screens of a web export, served against the mock
// backend. Used to prove a refactor changed nothing: shoot the export built
// before the change and the one built after, then compare with
// e2e/compare-shots.ts.
//
//   node e2e/screens.ts <dist dir> <out dir> <api port>
//
// The api port must match the EXPO_PUBLIC_API_URL the export was built with,
// because Expo inlines that value into the bundle.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { startMockBackend } from "./mock-backend.ts";
import { serveStatic } from "./static-server.ts";

const [distDir, outDir, apiPort] = process.argv.slice(2);
if (!distDir || !outDir || !apiPort) {
  console.error("usage: node e2e/screens.ts <dist dir> <out dir> <api port>");
  process.exit(2);
}

async function settle(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const backend = await startMockBackend(Number(apiPort));
  const site = await serveStatic(distDir);
  const browser = await chromium.launch();
  const shot = (page: Page, name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(site.url);
    await settle(page, "March 12");
    await shot(page, "today");

    await page.getByText("Open hardware boards ship with mainline kernels").first().click();
    await settle(page, "1 of 4");
    await shot(page, "article");

    await page.getByText("‹").first().click();
    await page.getByText("Archive", { exact: true }).click();
    await settle(page, "Every edition");
    await shot(page, "archive");

    await page.getByText("March 11").first().click();
    await settle(page, "2 stories");
    await shot(page, "archive-edition");

    backend.state.failAll = true;
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const errPage = await fresh.newPage();
    await errPage.goto(site.url);
    await settle(errPage, "load digests");
    await shot(errPage, "error");

    console.log(`screens: 5 shots in ${outDir}; page errors: ${errors.length}`);
    for (const e of errors) console.log(`  page error: ${e}`);
  } finally {
    await browser.close();
    await site.close();
    await backend.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
