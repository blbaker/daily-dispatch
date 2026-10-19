// A stand-in for the Daily Dispatch backend, for local browser runs. It serves
// the fixture editions and the push routes from docs/push-setup.md, records
// every request, and answers CORS preflights the way the Function URL does.
// Run it alone with `node e2e/mock-backend.ts [port]`.
import { createHash } from "node:crypto";
import http from "node:http";
import { editionById, editionList } from "./fixtures.ts";

export const MOCK_API_KEY = "local-test-key";

export interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

export interface MockNotification {
  id: string;
  event: "edition" | "episode";
  refId: string;
  title: string;
  body: string;
  data: Record<string, string>;
  createdAt: string;
}

export interface MockState {
  requests: Recorded[];
  devices: Map<string, Record<string, unknown>>;
  settings: { notifications: Record<string, boolean>; updatedAt: string | null };
  notifications: MockNotification[];
  vapidPublicKey: string | null;
  failAll: boolean;
}

export interface MockBackend {
  url: string;
  state: MockState;
  close(): Promise<void>;
}

type Reply = [number, unknown];

function deviceId(kind: string, key: string): string {
  return createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 24);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(raw);
      }
    });
  });
}

function register(state: MockState, body: any): Reply {
  if (!body || typeof body !== "object") return [400, { error: "body must be JSON" }];
  const { platform, kind } = body;
  let key: string | undefined;
  if (kind === "webpush") key = body.subscription?.endpoint;
  else key = body.token;
  if (typeof key !== "string" || !key) return [400, { error: "token or subscription required" }];
  const id = deviceId(kind, key);
  const now = new Date().toISOString();
  const prev = state.devices.get(id);
  const device = {
    id,
    platform,
    kind,
    name: body.name,
    prefs: body.prefs ?? prev?.prefs ?? { enabled: true, newEdition: true, newEpisode: true },
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  state.devices.set(id, { ...device, token: body.token, subscription: body.subscription });
  return [200, { device }];
}

function since(state: MockState, query: URLSearchParams): Reply {
  const ts = query.get("ts") ?? "";
  const ms = /^\d+$/.test(ts) ? Number(ts) : Date.parse(ts);
  if (Number.isNaN(ms)) return [400, { error: "ts must be an ISO time or epoch milliseconds" }];
  const dev = query.get("device");
  if (dev && !state.devices.has(dev)) return [404, { error: "unknown device; register it again with POST /devices" }];
  const after = state.notifications.filter((n) => Date.parse(n.createdAt) > ms);
  const last = after[after.length - 1];
  return [200, { notifications: after, cursor: last ? last.createdAt : new Date(ms).toISOString() }];
}

async function route(state: MockState, method: string, url: URL, body: unknown): Promise<Reply> {
  const p = url.pathname;
  let m: RegExpExecArray | null;
  if (method === "GET" && p === "/editions") return [200, { editions: editionList() }];
  if (method === "GET" && (m = /^\/editions\/([\d-]+)$/.exec(p))) {
    const ed = editionById(m[1]);
    return ed ? [200, ed] : [404, { error: "not found" }];
  }
  if (method === "GET" && p === "/push/config") {
    return [200, { expo: { enabled: false }, webpush: { enabled: !!state.vapidPublicKey, vapidPublicKey: state.vapidPublicKey } }];
  }
  if (method === "POST" && p === "/devices") return register(state, body);
  if (method === "DELETE" && (m = /^\/devices\/([0-9a-f]{24})$/.exec(p))) {
    return [200, { ok: true, removed: state.devices.delete(m[1]) }];
  }
  if (method === "GET" && p === "/settings") return [200, state.settings];
  if (method === "PUT" && p === "/settings") {
    const patch = (body as any)?.notifications ?? {};
    state.settings = { notifications: { ...state.settings.notifications, ...patch }, updatedAt: new Date().toISOString() };
    return [200, state.settings];
  }
  if (method === "GET" && p === "/notifications/since") return since(state, url.searchParams);
  if (method === "GET" && (m = /^\/episodes\/([\w-]+)$/.exec(p))) {
    return [200, { id: m[1], title: `Episode ${m[1]}`, audioUrl: `https://example.com/audio/${m[1]}.mp3` }];
  }
  return [404, { error: `no route for ${method} ${p}` }];
}

export function startMockBackend(port = 0, vapidPublicKey: string | null = null): Promise<MockBackend> {
  const state: MockState = {
    requests: [],
    devices: new Map(),
    settings: { notifications: { enabled: true, newEdition: true, newEpisode: true }, updatedAt: null },
    notifications: [],
    vapidPublicKey,
    failAll: false,
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type,x-api-key");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://mock.local");
    const body = await readBody(req);
    state.requests.push({ method: req.method ?? "GET", path: url.pathname + url.search, body });
    let reply: Reply;
    if (state.failAll) reply = [500, { error: "mock failure" }];
    else if (req.headers["x-api-key"] !== MOCK_API_KEY) reply = [403, { error: "bad api key" }];
    else reply = await route(state, req.method ?? "GET", url, body);
    res.writeHead(reply[0], { "content-type": "application/json" }).end(JSON.stringify(reply[1]));
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        state,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? 8787);
  startMockBackend(port).then((b) => console.log(`mock backend on ${b.url}`));
}
