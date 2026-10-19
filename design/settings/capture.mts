// Renders the Settings mockups headless and writes one PNG per size and
// scheme: phone 390x844, e-ink 702x936 (the Boox Note Air panel, 1404x1872,
// at 2x) and desktop 1280x800, each light and dark.
//
// Each PNG is a contact sheet of real viewport frames: an iframe at the exact
// size per frame, scrolled from the top of the page to the bottom, so media
// queries and fixed bars behave as they would on the device. Chrome's
// --window-size flag is not used because it crops instead of resizing.
//
// Usage: CHROME_BIN=<path to chrome> node design/settings/capture.mts [outDir]
// Needs Node 22.18 or newer (runs TypeScript directly) and no npm packages.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

type Frame = { page: string; w: number; h: number; params: string; scroll?: "auto" };
type Shot = { name: string; dir: "row" | "column"; dpr: number; frames: Frame[] };
type Metrics = {
  src: string; width: number; height: number; scrollHeight: number;
  scrollWidth: number; scrollY: number; font: boolean; title: string;
};
type Sheet = { width: number; height: number; frames: Metrics[] };

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, "shots");
const CHROME = process.env.CHROME_BIN ?? "";

const shots: Shot[] = (["light", "dark"] as const).flatMap((scheme): Shot[] => [
  { name: `phone-${scheme}`, dir: "row", dpr: 2, frames: [
    { page: "today.html", w: 390, h: 844, params: `scheme=${scheme}&chrome=phone` },
    { page: "settings.html", w: 390, h: 844, params: `scheme=${scheme}&chrome=phone`, scroll: "auto" },
    { page: "settings.html", w: 390, h: 844, params: `scheme=${scheme}&chrome=phone&sheet=voice` },
  ] },
  { name: `eink-${scheme}`, dir: "row", dpr: 2, frames: [
    { page: "settings.html", w: 702, h: 936, params: `scheme=${scheme}&eink=1&chrome=eink`, scroll: "auto" },
  ] },
  { name: `desktop-${scheme}`, dir: "column", dpr: 1.5, frames: [
    { page: "settings.html", w: 1280, h: 800, params: `scheme=${scheme}`, scroll: "auto" },
  ] },
]).filter((s) => !process.env.ONLY || s.name === process.env.ONLY)
  .sort((a, b) => order(a.name) - order(b.name));

function order(name: string): number {
  return ["phone", "eink", "desktop"].indexOf(name.split("-")[0]) * 2 + (name.endsWith("dark") ? 1 : 0);
}

// The sheet page builds the frames in the browser. For a scrolling page it
// loads a probe copy to measure it, then steps down the page one frame at a
// time. Each step starts the next frame at the row that the previous frame
// cut off at its bottom edge, so no frame opens on a half-visible row and
// nothing between frames is skipped.
const SHEET_SCRIPT = `
const ROWS = ".sec,.row,.field,.time-block,.size-block,.test,.atoms,.preview";
const wait = (f) => new Promise((res) => {
  const t = setInterval(() => {
    const d = f.contentDocument;
    if (d && d.documentElement.dataset.ready === "1") { clearInterval(t); res(f.contentWindow.__metrics); }
  }, 50);
});
const frame = (src, w, h) => {
  const f = document.createElement("iframe");
  f.src = src; f.style.width = w + "px"; f.style.height = h + "px";
  f.dataset.w = w; f.dataset.h = h;
  return f;
};
async function offsets(base, w, h) {
  const p = frame(base, w, h);
  p.style.position = "absolute"; p.style.left = "-99999px";
  document.body.appendChild(p);
  const m = await wait(p);
  const d = p.contentDocument;
  const sb = d.querySelector(".statusbar");
  const top = sb && getComputedStyle(sb).display !== "none" ? sb.offsetHeight : 0;
  const tab = d.querySelector(".tabbar");
  const bar = tab ? tab.offsetHeight : 0;
  const max = m.scrollHeight - h;
  const starts = [...d.querySelectorAll(ROWS)].map((e) => Math.round(e.getBoundingClientRect().top));
  p.remove();
  const offs = [0];
  let last = 0;
  while (last < max) {
    const seenTo = last + h - bar;
    const cut = starts.filter((t) => t > last + top + 80 && t <= seenTo);
    let next = cut.length ? Math.max(...cut) - top : last + h - top - bar - 32;
    if (next >= max) next = max;
    offs.push(next);
    last = next;
  }
  return offs;
}
(async () => {
  const s = document.getElementById("s");
  const frames = [];
  for (const fr of spec) {
    const base = "/" + fr.page + "?" + fr.params;
    const offs = fr.scroll === "auto" ? await offsets(base, fr.w, fr.h) : [null];
    for (const o of offs) {
      const f = frame(base + (o === null ? "" : "&scroll=" + o), fr.w, fr.h);
      s.appendChild(f);
      frames.push(f);
    }
  }
  const ms = await Promise.all(frames.map(wait));
  const r = s.getBoundingClientRect();
  window.__sheet = {
    width: Math.ceil(r.width), height: Math.ceil(r.height),
    frames: ms.map((m, i) => ({ src: frames[i].getAttribute("src"),
      want: [+frames[i].dataset.w, +frames[i].dataset.h], ...m })),
  };
  document.title = "ready";
})();`;

function sheetHtml(shot: Shot): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>sheet</title><style>
html,body{margin:0;background:#7F7F7F}
#s{display:flex;flex-direction:${shot.dir};gap:24px;padding:24px;align-items:flex-start;width:max-content}
iframe{border:0;display:block;flex:none}</style></head><body><div id="s"></div>
<script>const spec = ${JSON.stringify(shot.frames)};${SHEET_SCRIPT}</script></body></html>`;
}

const TYPES: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".woff2": "font/woff2", ".txt": "text/plain",
};

function serve(): Promise<{ port: number; close: () => void }> {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const sheet = /^\/__sheet\/([\w-]+)$/.exec(path);
    if (sheet) {
      const shot = shots.find((s) => s.name === sheet[1]);
      res.writeHead(shot ? 200 : 404, { "content-type": "text/html" });
      res.end(shot ? sheetHtml(shot) : "no such shot");
      return;
    }
    const file = normalize(join(HERE, path));
    if (!file.startsWith(HERE)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}

function launchChrome(profile: string): Promise<{ port: number; kill: () => void }> {
  const args = [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio",
    "--disable-lcd-text", // phones and e-paper use grayscale text antialiasing
    ...(process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${log.slice(-600)}`)), 20000);
    proc.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(log);
      if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), kill: () => proc.kill() }); }
    });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}:\n${log.slice(-600)}`)); });
  });
}

class Cdp {
  private ws: WebSocket;
  private next = 1;
  private waiting = new Map<number, (msg: { result?: any; error?: any }) => void>();
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        console.error(`page error: ${d.exception?.description ?? d.text} (${d.url ?? ""}:${d.lineNumber})`);
      }
      const done = this.waiting.get(msg.id);
      if (done) { this.waiting.delete(msg.id); done(msg); }
    });
  }
  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    return new Cdp(ws);
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.next++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    });
  }
  async eval<T>(expr: string, awaitPromise = false): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
    return r.result.value as T;
  }
  close(): void { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Counts pixels whose RGB channels differ by more than 2, by decoding the PNG
// in the page. Used to prove the e-ink renders are pure grayscale.
async function chromaPixels(cdp: Cdp, b64: string): Promise<number> {
  return cdp.eval<number>(`(async () => {
    const img = new Image();
    img.src = "data:image/png;base64,${b64}";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 2) n++;
    }
    return n;
  })()`, true);
}

function check(shot: Shot, sheet: Sheet): string[] {
  const problems: string[] = [];
  for (const f of sheet.frames as (Metrics & { want: [number, number] })[]) {
    const [w, h] = f.want;
    if (f.width !== w || f.height !== h) problems.push(`${f.src}: viewport ${f.width}x${f.height}, wanted ${w}x${h}`);
    if (f.scrollWidth > f.width) problems.push(`${f.src}: horizontal overflow ${f.scrollWidth}px`);
    if (!f.font) problems.push(`${f.src}: Roboto did not load`);
    if (!/mockup/.test(f.title)) problems.push(`${f.src}: unexpected page "${f.title}"`);
  }
  if (!sheet.frames.length) problems.push(`${shot.name}: no frames`);
  return problems;
}

async function main(): Promise<void> {
  if (!CHROME) throw new Error("Set CHROME_BIN to a Chrome or Chromium binary.");
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.port}`;
  const probe = await (await fetch(`${base}/settings.html`)).text();
  if (!probe.includes("<title>Settings mockup</title>")) throw new Error(`port ${server.port} is serving something else`);

  const chrome = await launchChrome(await mkdtemp(join(tmpdir(), "settings-capture-")));
  const target = (await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
  const cdp = await Cdp.open(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const index: Record<string, unknown> = {};
  let failed = 0;
  for (const shot of shots) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 3000, height: 2000, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `${base}/__sheet/${shot.name}` });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) { await sleep(100); ready = (await cdp.eval<string>("document.title")) === "ready"; }
    if (!ready) {
      const state = await cdp.eval<string>("JSON.stringify([...document.querySelectorAll('iframe')].map((f) => f.contentDocument?.title))");
      console.error(`${shot.name}: sheet never became ready; frame titles ${state}`);
      failed++;
      continue;
    }
    const sheet = await cdp.eval<Sheet>("window.__sheet");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: sheet.width, height: sheet.height, deviceScaleFactor: shot.dpr, mobile: false,
    });
    await sleep(400);
    const png = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(OUT, `${shot.name}.png`), Buffer.from(png.data, "base64"));
    const problems = check(shot, sheet);
    const chroma = shot.name.startsWith("eink") ? await chromaPixels(cdp, png.data) : null;
    if (chroma) problems.push(`${chroma} pixels are not gray`);
    failed += problems.length ? 1 : 0;
    index[shot.name] = { file: `${shot.name}.png`, dpr: shot.dpr, chroma, ...sheet, problems };
    const px = `${Math.round(sheet.width * shot.dpr)}x${Math.round(sheet.height * shot.dpr)}`;
    console.log(`${shot.name}: ${sheet.frames.length} frames, ${px}px${chroma === 0 ? ", grayscale" : ""}${problems.length ? `, PROBLEMS: ${problems.join("; ")}` : ", checks ok"}`);
  }
  await writeFile(join(OUT, "index.json"), JSON.stringify(index, null, 2));
  cdp.close();
  chrome.kill();
  server.close();
  const captured = Object.keys(index).length;
  console.log(`captured ${captured}/${shots.length}`);
  if (failed || captured !== shots.length) process.exit(1);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
