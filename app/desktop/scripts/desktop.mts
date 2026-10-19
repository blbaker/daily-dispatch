// Desktop launcher for the Daily Dispatch app.
//
//   node scripts/desktop.mts bundle            build build/app/index.impeller.bundle
//   node scripts/desktop.mts run [args]        bundle, then open the app in a window
//   node scripts/desktop.mts demo [args]       same, against the local mock API
//
// `run` reads EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY from the shell or
// from app/.env, the same as the phone and web builds. `demo` needs neither:
// it serves the sample editions from fixtures/ on 127.0.0.1.
//
// Flags: --no-bundle reuses the last bundle. Every other argument goes to the
// engine unchanged (for example `--color-scheme dark`, or `--headless
// --frames 30 --screenshot /abs/out.ppm`); a bare `--` is ignored.
import { join } from "node:path";
import { appConfig, baseEngineArgs, bundle, desktopRoot, engine, loadAppEnv, runEngine } from "./lib.mts";
import { MOCK_API_KEY, startMockApi } from "./mock-api.mts";

const OWN_FLAGS = new Set(["--no-bundle"]);
const [command = "run", ...rest] = process.argv.slice(2);
const ownFlags = rest.filter((a) => OWN_FLAGS.has(a));
const engineArgs = rest.filter((a) => !OWN_FLAGS.has(a) && a !== "--");
const outDir = join(desktopRoot, "build", "app");
const bundlePath = join(outDir, "index.impeller.bundle");

// Window mode, title and size from app.json, unless the caller chose them.
function windowArgs(): string[] {
  const { displayName, window } = appConfig();
  const has = (flag: string) => engineArgs.includes(flag);
  const out: string[] = [];
  if (!has("--headless") && !has("--window")) out.push("--window", "--title", displayName);
  if (!has("--width")) out.push("--width", String(window.width));
  if (!has("--height")) out.push("--height", String(window.height));
  return out;
}

async function launch(env: NodeJS.ProcessEnv): Promise<number> {
  if (!ownFlags.includes("--no-bundle")) {
    console.log("desktop: bundling for platform impeller...");
    bundle({ outDir, env });
  }
  const { binary, source } = engine();
  console.log(`desktop: engine ${binary} (${source})`);
  const run = await runEngine([...baseEngineArgs(bundlePath), ...windowArgs(), ...engineArgs], {
    cwd: outDir,
    env,
    timeoutMs: 24 * 60 * 60 * 1000,
    inherit: true,
  });
  if (run.code !== 0) console.error(`desktop: engine exited ${run.code}`);
  return run.code ?? 1;
}

async function main(): Promise<number> {
  switch (command) {
    case "bundle":
      console.log(bundle({ outDir }));
      return 0;
    case "run":
      return launch(loadAppEnv());
    case "demo": {
      const api = await startMockApi();
      console.log(`desktop: mock API on ${api.url}`);
      try {
        return await launch({ ...loadAppEnv(), EXPO_PUBLIC_API_URL: api.url, EXPO_PUBLIC_API_KEY: MOCK_API_KEY });
      } finally {
        await api.close();
      }
    }
    default:
      console.error(`unknown command "${command}" (expected bundle, run or demo)`);
      return 2;
  }
}

process.exitCode = await main();
