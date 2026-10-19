// Test helpers for the notices generator: build a throwaway app folder with a
// package-lock.json and a node_modules tree, and run the CLI against it.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const script = fileURLToPath(new URL("./generate-notices.mts", import.meta.url));

export type FakePackage = {
  name: string;
  version?: string;
  license?: unknown;
  author?: unknown;
  // More package.json fields, such as the old "licenses" form.
  manifest?: Record<string, unknown>;
  files?: Record<string, string>;
  dev?: boolean;
  optional?: boolean;
  os?: string[];
  cpu?: string[];
  installed?: boolean;
  // Lockfile key; defaults to node_modules/<name>.
  path?: string;
};

export type Fixture = { root: string; app: string; allowlist: string; out: string };

export function tempRoot(prefix = "notices-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeApp(app: string, packages: FakePackage[]): void {
  const lock: Record<string, unknown> = { "": { name: "fixture-app", version: "1.0.0" } };
  for (const p of packages) {
    const key = p.path ?? `node_modules/${p.name}`;
    const version = p.version ?? "1.0.0";
    lock[key] = {
      version,
      ...(p.license === undefined ? {} : { license: p.license }),
      ...(p.dev ? { dev: true } : {}),
      ...(p.optional ? { optional: true } : {}),
      ...(p.os ? { os: p.os } : {}),
      ...(p.cpu ? { cpu: p.cpu } : {}),
    };
    if (p.installed === false) continue;
    const dir = join(app, ...key.split("/"));
    mkdirSync(dir, { recursive: true });
    const manifest: Record<string, unknown> = { name: p.name, version, ...p.manifest };
    if (p.license !== undefined) manifest.license = p.license;
    if (p.author !== undefined) manifest.author = p.author;
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    for (const [file, text] of Object.entries(p.files ?? {})) writeFileSync(join(dir, file), text);
  }
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "package-lock.json"), JSON.stringify({ name: "fixture-app", lockfileVersion: 3, packages: lock }));
}

export function fixture(packages: FakePackage[], allow: unknown[] = [], texts: Record<string, string> = {}): Fixture {
  const root = tempRoot();
  const app = join(root, "app");
  writeApp(app, packages);
  const allowDir = join(root, "allow");
  mkdirSync(allowDir);
  for (const [file, text] of Object.entries(texts)) writeFileSync(join(allowDir, file), text);
  const allowlist = join(allowDir, "allowlist.json");
  writeFileSync(allowlist, JSON.stringify({ packages: allow }));
  return { root, app, allowlist, out: join(root, "out") };
}

export function run(f: Fixture, target: string, extra: string[] = []): { status: number | null; stdout: string } {
  const args = [script, "--target", target, "--out", f.out, "--app-dir", f.app, "--allowlist", f.allowlist, ...extra];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout + r.stderr };
}

export const MIT_TEXT = "MIT License\n\nCopyright (c) 2024 Fixture Author\n\nPermission is hereby granted...\n";
