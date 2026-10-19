// Local stand-in for the Daily Dispatch backend, serving the sample editions in
// fixtures/sample-editions.json. The desktop gate and `npm run demo` point the
// app at it, so neither needs the real API, a key, or the network.
//
// It answers the same routes the app calls (GET /editions, GET /editions/:id)
// and checks the x-api-key header, so a bundle built without the key inlined
// fails here the same way it would against the real backend. Story images are
// gradients generated on request under /img/.
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./ppm.mts";

export const MOCK_API_KEY = "local-demo-key";

type Story = { headline: string; [k: string]: unknown };
type Edition = { id: string; date: string; weekday: string; full: string; hero?: string; stories: Story[] };

export type MockApi = { url: string; hits: string[]; close: () => Promise<void> };

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "sample-editions.json");

function loadEditions(base: string): Edition[] {
  const text = readFileSync(FIXTURE, "utf8").replaceAll("{{base}}", base);
  return (JSON.parse(text) as { editions: Edition[] }).editions;
}

const PALETTE: [number, number, number][] = [
  [43, 108, 176], [44, 122, 123], [107, 70, 193], [183, 121, 31], [155, 44, 90], [47, 133, 90],
];

// A diagonal two-colour gradient picked from the image name, so every story
// image is distinct and stable between runs.
function gradientPng(name: string, width = 480, height = 320): Buffer {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = PALETTE[h % PALETTE.length];
  const b = PALETTE[(h >>> 8) % PALETTE.length];
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) rgb[o + c] = Math.round(a[c] * (1 - t) + b[c] * t);
    }
  }
  return encodePng({ width, height, rgb });
}

export function startMockApi(port = 0, host = "127.0.0.1"): Promise<MockApi> {
  const hits: string[] = [];
  let base = "";
  const server: Server = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    hits.push(path);
    const send = (status: number, type: string, body: string | Buffer) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    const img = /^\/img\/([\w-]+)\.png$/.exec(path);
    if (img) return send(200, "image/png", gradientPng(img[1]));
    // Like the real backend, /health needs no key (Settings > Server tests it).
    if (path === "/health") return send(200, "application/json", '{"ok":true}');
    if (req.headers["x-api-key"] !== MOCK_API_KEY) return send(401, "application/json", '{"error":"bad key"}');
    const editions = loadEditions(base);
    if (path === "/editions") {
      const list = editions.map((e) => ({
        id: e.id, date: e.date, weekday: e.weekday, full: e.full, hero: e.hero,
        count: e.stories.length, lead: e.stories[0]?.headline ?? "",
      }));
      return send(200, "application/json", JSON.stringify({ editions: list }));
    }
    const one = /^\/editions\/([\w-]+)$/.exec(path);
    const ed = one && editions.find((e) => e.id === one[1]);
    if (ed) return send(200, "application/json", JSON.stringify(ed));
    return send(404, "application/json", '{"error":"not found"}');
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("mock API has no port"));
      base = `http://${host}:${addr.port}`;
      resolve({ url: base, hits, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// `node scripts/mock-api.mts [port]` runs it on its own until Ctrl+C.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const api = await startMockApi(Number(process.argv[2] || 0));
  console.log(`mock API on ${api.url} (key: ${MOCK_API_KEY})`);
}
