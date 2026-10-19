// Serves a static web export (the output of `expo export --platform web`) on
// 127.0.0.1. Unknown paths fall back to index.html, as a static host
// configured for a single-page app would do. localhost counts as a secure
// context, so service workers and Push work here without TLS.
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
};

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export function serveStatic(root: string, port = 0): Promise<StaticServer> {
  const base = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://static.local").pathname);
    let file = path.join(base, pathname);
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    if (!(await isFile(file))) file = path.join(base, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
