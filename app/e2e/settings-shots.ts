// Screenshots of the Settings screen in a web export, for comparing with the
// approved mockups in design/settings. Same frames as design/settings/
// capture.mts: phone 390x844 and e-ink 702x936 as rows, desktop 1280x800 as
// a column, each scrolled from the top of the screen to the bottom.
//
//   node e2e/settings-shots.ts <dist dir> <out dir> <api port> <phone|eink|desktop>
//
// Writes <variant>-light.png and <variant>-dark.png. Use the EXPO_PUBLIC_EINK
// export for "eink". The mock backend starts with the mockups' podcast
// settings so the two can be compared row by row.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { startMockBackend } from "./mock-backend.ts";
import { serveStatic } from "./static-server.ts";

const [distDir, outDir, apiPort, variant] = process.argv.slice(2);
const SIZES = {
  phone: { width: 390, height: 844, dpr: 2, dir: "row", today: true, sheet: true },
  eink: { width: 702, height: 936, dpr: 2, dir: "row", today: false, sheet: false },
  desktop: { width: 1280, height: 800, dpr: 1.5, dir: "column", today: false, sheet: false },
} as const;
if (!distDir || !outDir || !apiPort || !(variant in SIZES)) {
  console.error("usage: node e2e/settings-shots.ts <dist dir> <out dir> <api port> <phone|eink|desktop>");
  process.exit(2);
}
const size = SIZES[variant as keyof typeof SIZES];

/** The podcast section the mockups show. */
export const MOCKUP_PODCAST = {
  enabled: true, time: "06:00", timezone: "America/New_York", voiceProvider: "elevenlabs",
  scriptWriter: "command", hostVoices: { "Host 1": "Aria", "Host 2": "Roger" },
};

// The Settings ScrollView is the one element on the page that scrolls.
const SCROLLER = `(() => {
  const root = document.querySelector('[data-testid="settings-screen"]');
  return [...root.querySelectorAll("div")].find((d) => {
    const o = getComputedStyle(d).overflowY;
    return (o === "auto" || o === "scroll") && d.scrollHeight > d.clientHeight;
  });
})()`;

async function frames(page: Page, prefix: string): Promise<string[]> {
  const shots: string[] = [];
  const shoot = async (name: string) => {
    const file = path.join(outDir, `${prefix}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  };
  if (size.today) {
    await page.getByText("March 12").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
    await shoot("today");
  }
  await page.getByTestId("tab-settings").click();
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  const { max, view } = await page.evaluate(`(() => { const s = ${SCROLLER}; return { max: s.scrollHeight - s.clientHeight, view: s.clientHeight }; })()`) as { max: number; view: number };
  const step = Math.max(200, view - 120);
  for (let y = 0, n = 0; ; y = Math.min(max, y + step), n++) {
    await page.evaluate(`(() => { ${SCROLLER}.scrollTop = ${y}; })()`);
    await page.waitForTimeout(250);
    await shoot(`settings-${n}`);
    if (y >= max) break;
  }
  if (size.sheet) {
    await page.getByTestId("podcast-voice").click();
    await page.getByTestId("settings-sheet").waitFor();
    await page.waitForTimeout(300);
    await shoot("sheet-voice");
  }
  return shots;
}

/** Lays the frames side by side (or stacked) on a gray sheet, like capture.mts. */
async function contactSheet(page: Page, files: string[], out: string): Promise<void> {
  const imgs = await Promise.all(files.map(async (f) => `data:image/png;base64,${(await readFile(f)).toString("base64")}`));
  const w = size.width, h = size.height, gap = 24;
  const row = size.dir === "row";
  const W = row ? files.length * (w + gap) + gap : w + 2 * gap;
  const H = row ? h + 2 * gap : files.length * (h + gap) + gap;
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(`<body style="margin:0;background:#8a8a8a;display:flex;flex-direction:${row ? "row" : "column"};gap:${gap}px;padding:${gap}px">${
    imgs.map((src) => `<img src="${src}" style="width:${w}px;height:${h}px;display:block">`).join("")}</body>`);
  await page.waitForLoadState("load");
  await page.screenshot({ path: out });
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const backend = await startMockBackend(Number(apiPort));
  backend.state.settings.podcast = { ...MOCKUP_PODCAST };
  backend.state.settings.updatedAt = new Date().toISOString();
  const site = await serveStatic(distDir);
  const browser = await chromium.launch();
  const report: Record<string, unknown> = {};
  try {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr, colorScheme: scheme,
        timezoneId: "America/Chicago",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(site.url);
      const files = await frames(page, `${variant}-${scheme}`);
      const sheet = path.join(outDir, `${variant}-${scheme}.png`);
      await contactSheet(page, files, sheet);
      const metrics = await page.evaluate("({ w: document.documentElement.scrollWidth })");
      report[`${variant}-${scheme}`] = { frames: files.length, pageErrors: errors, metrics };
      console.log(`${variant}-${scheme}: ${files.length} frames, page errors ${errors.length}`);
      for (const e of errors) console.log(`  page error: ${e.slice(0, 200)}`);
      await context.close();
    }
    await writeFile(path.join(outDir, `${variant}-report.json`), JSON.stringify(report, null, 2));
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
