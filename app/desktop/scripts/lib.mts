// Shared helpers for the desktop scripts: paths, .env loading, bundling with
// Metro for platform "impeller", and locating the engine binary.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const appRoot = resolve(desktopRoot, "..");
const require = createRequire(join(desktopRoot, "package.json"));

export type AppConfig = { name: string; displayName: string; window: { width: number; height: number } };

export function appConfig(): AppConfig {
  return JSON.parse(readFileSync(join(desktopRoot, "app.json"), "utf8")) as AppConfig;
}

// Expo CLI reads app/.env for the phone and web builds. Do the same here so
// one .env drives every build. Variables already set in the shell win.
export function loadAppEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const file of [".env", ".env.local"]) {
    const path = join(appRoot, file);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      if (out[key] === undefined) out[key] = value;
    }
  }
  return out;
}

export type BundleOptions = { outDir: string; env?: NodeJS.ProcessEnv; dev?: boolean; entry?: string };

// Runs `react-native bundle --platform impeller` and returns the absolute
// bundle path. The engine needs absolute paths, so everything is resolved.
export function bundle({ outDir, env = loadAppEnv(), dev = false, entry = "index.ts" }: BundleOptions): string {
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const bundlePath = join(out, "index.impeller.bundle");
  const cli = require.resolve("@react-native-community/cli/build/bin.js");
  const args = [
    cli, "bundle", "--platform", "impeller", "--dev", String(dev),
    "--entry-file", entry, "--bundle-output", bundlePath, "--assets-dest", join(out, "assets"),
  ];
  const r = spawnSync(process.execPath, args, { cwd: desktopRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  const log = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0 || !existsSync(bundlePath)) {
    const tail = log.split("\n").filter((l) => /error|Error/.test(l)).slice(0, 8).join("\n");
    throw new Error(`Metro bundle failed (exit ${r.status}).\n${tail}`);
  }
  return bundlePath;
}

export type Engine = { binary: string; source: string; packageName?: string };

// The engine arrives as an optional dependency of react-native-impeller-platform
// matching this OS and CPU. IMPELLER_ENGINE_BINARY overrides it for engine work.
export function engine(): Engine {
  const { resolveEngine } = require("react-native-impeller-platform") as { resolveEngine: () => Engine };
  return resolveEngine();
}

// Arguments every launch passes: the bundle, the registered app name, and no
// debug banner.
export function baseEngineArgs(bundlePath: string): string[] {
  return ["--bundle", resolve(bundlePath), "--app-name", appConfig().name, "--probe-banner", "off"];
}

export type EngineRun = { code: number | null; log: string };

// Runs the engine without blocking Node's event loop, so an HTTP server in
// this same process (the mock API) keeps answering while the app runs.
export function runEngine(
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; inherit?: boolean },
): Promise<EngineRun> {
  const { binary } = engine();
  return new Promise((done) => {
    const stdio = opts.inherit ? "inherit" : "pipe";
    const child = spawn(binary, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio });
    let log = "";
    child.stdout?.on("data", (d) => (log += d));
    child.stderr?.on("data", (d) => (log += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 180_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, log });
    });
  });
}
