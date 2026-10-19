// Desktop gate: bundle the app, run it headless on this machine's engine
// against the local mock API, and check three screens actually render.
//
//   node scripts/gate.mts [--out DIR]
//
// Scenarios (480x900 window, sample editions from fixtures/):
//   today    no input; the slanted hero and the lead story must be on screen.
//   archive  tap the Archive tab; the edition cards must replace Today.
//   article  tap the lead story; the article reader must replace Today.
//   settings tap the Settings tab; the Settings screen must replace Today
//            and its Server section must have called /health.
// Each frame must be non-blank and differ from the others, the app must have
// fetched the edition from the mock API, and the AsyncStorage shim must have
// written its offline cache to disk.
//
// Control: the same "today" run on a bundle that throws at startup must be
// judged a FAILURE. If the checks pass a broken bundle, the gate fails.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { baseEngineArgs, bundle, desktopRoot, engine, loadAppEnv, runEngine } from "./lib.mts";
import { MOCK_API_KEY, startMockApi } from "./mock-api.mts";
import { diffFraction, frameStats, readPpm, writePng, type Frame } from "./ppm.mts";

const WIDTH = 480;
const HEIGHT = 900;
const FRAMES = "60";
const LATEST = "2026-10-18"; // newest edition in fixtures/sample-editions.json
// Three tabs share the 480px window: Today 0-160, Archive 160-320, Settings 320-480.
const TAP_ARCHIVE_TAB = "240,880";
const TAP_SETTINGS_TAB = "400,880";
const TAP_LEAD_STORY = "200,670";
const WEDGE_PROBE = [440, 600] as const;

function pixel(frame: Frame, x: number, y: number): number[] {
  const o = (y * frame.width + x) * 3;
  return [frame.rgb[o], frame.rgb[o + 1], frame.rgb[o + 2]];
}

type Result = { name: string; ok: boolean; notes: string[]; frame?: Frame };

const argOut = process.argv.indexOf("--out");
const outDir = resolve(argOut > 0 ? process.argv[argOut + 1] : join(desktopRoot, "build", "gate"));
mkdirSync(outDir, { recursive: true });

function notBlank(frame: Frame | undefined, notes: string[]): boolean {
  if (!frame) {
    notes.push("no screenshot written");
    return false;
  }
  const s = frameStats(frame);
  notes.push(`distinct_colors=${s.distinctColors} ink=${s.inkFraction.toFixed(3)}`);
  return s.distinctColors >= 32 && s.inkFraction >= 0.05;
}

async function scenario(name: string, bundlePath: string, storageDir: string, extra: string[]): Promise<Result> {
  const shot = join(outDir, `${name}.ppm`);
  const args = [
    ...baseEngineArgs(bundlePath), "--headless", "--width", String(WIDTH), "--height", String(HEIGHT),
    "--frames", FRAMES, "--screenshot", shot, ...extra,
  ];
  const run = await runEngine(args, { cwd: outDir, env: { ...process.env, RNI_STORAGE_DIR: storageDir } });
  writeFileSync(join(outDir, `${name}.log`), run.log);
  const notes = [`exit=${run.code}`];
  const frame = existsSync(shot) && run.code === 0 ? readPpm(shot) : undefined;
  if (frame) writePng(join(outDir, `${name}.png`), frame);
  let ok = run.code === 0 && run.log.includes("RN_IMPELLER_RENDER_OK");
  if (extra.includes("--tap") && !/tap_hit=\d+/.test(run.log)) {
    notes.push("tap did not hit a view");
    ok = false;
  }
  ok = notBlank(frame, notes) && ok;
  return { name, ok, notes, frame };
}

function expect(r: Result, cond: boolean, note: string): void {
  if (!cond) {
    r.ok = false;
    r.notes.push(`FAIL ${note}`);
  }
}

async function main(): Promise<number> {
  const api = await startMockApi();
  const env = { ...loadAppEnv(), EXPO_PUBLIC_API_URL: api.url, EXPO_PUBLIC_API_KEY: MOCK_API_KEY };
  console.log(`gate: engine ${engine().binary}`);
  const bundlePath = bundle({ outDir, env, entry: "gate/entry.ts" });
  console.log(`gate: bundle ${bundlePath}`);
  const storage = mkdtempSync(join(outDir, "storage-"));

  const today = await scenario("today", bundlePath, storage, []);
  expect(today, api.hits.includes("/editions") && api.hits.includes(`/editions/${LATEST}`), "app never fetched the latest edition");
  expect(today, today.frame !== undefined && frameStats(today.frame).inkFraction >= 0.4, "hero photo missing (ink < 0.4)");
  const cached = existsSync(storage) ? readdirSync(storage).length : 0;
  expect(today, cached >= 2, `offline cache has ${cached} entries, expected >= 2`);
  // The hero's slanted bottom edge is a border triangle with a transparent
  // side. Just right of the slant the photo must show, not black: engines
  // before react-native-impeller-platform 0.3.1 drew it black.
  const px = today.frame ? pixel(today.frame, WEDGE_PROBE[0], WEDGE_PROBE[1]) : [0, 0, 0];
  today.notes.push(`wedge_probe=${px.join(",")}`);
  expect(today, px[0] + px[1] + px[2] > 60, "black triangle under the hero (transparent border drawn black)");

  const archive = await scenario("archive", bundlePath, storage, ["--tap", TAP_ARCHIVE_TAB]);
  const article = await scenario("article", bundlePath, storage, ["--tap", TAP_LEAD_STORY]);
  const healthBefore = api.hits.filter((h) => h === "/health").length;
  const settings = await scenario("settings", bundlePath, storage, ["--tap", TAP_SETTINGS_TAB]);
  expect(settings, api.hits.filter((h) => h === "/health").length > healthBefore, "Settings never ran its connection test");
  for (const [r, other] of [[archive, today], [article, today], [article, archive], [settings, today], [settings, archive]] as const) {
    const d = r.frame && other.frame ? diffFraction(r.frame, other.frame) : 0;
    r.notes.push(`diff_vs_${other.name}=${d.toFixed(3)}`);
    expect(r, d >= 0.25, `${r.name} looks like ${other.name}; the tap did not change the screen`);
  }

  // Control: a bundle that throws on load must not pass the same checks.
  const broken = join(outDir, "broken.bundle");
  writeFileSync(broken, `throw new Error("desktop gate control: broken bundle");\n${readFileSync(bundlePath, "utf8")}`);
  const control = await scenario("control", broken, mkdtempSync(join(outDir, "storage-")), []);
  const controlCaught = !control.ok;
  await api.close();

  const results = [today, archive, article, settings];
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}: ${r.notes.join(" ")}`);
  console.log(`${controlCaught ? "ok  " : "FAIL"} control (broken bundle must fail): ${control.notes.join(" ")}`);
  const pass = results.every((r) => r.ok) && controlCaught;
  console.log(pass ? "DESKTOP_GATE_PASS" : "DESKTOP_GATE_FAIL");
  console.log(`gate: frames and logs in ${outDir}`);
  return pass ? 0 : 1;
}

process.exitCode = await main();
