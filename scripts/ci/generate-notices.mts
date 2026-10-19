// Write THIRD_PARTY_NOTICES-<target>.txt for one release artifact: every
// third-party package in that build with its name, version, license id and
// full license text.
//
//   node scripts/ci/generate-notices.mts --target TARGET --out DIR
//
// Run it after npm ci in the target's app folder (app/, or app/desktop for
// the desktop targets), on the machine CI builds that target on:
//   android  also lists the Maven modules on the release classpath, by running
//            Gradle in app/android (after npx expo prebuild --platform android)
//   ios      also lists the pods, from app/ios after pod install; that only
//            exists on macOS, so the iOS CI job is where this target runs
//   desktop  on its own OS, the only place npm installs that OS's engine
// The run fails on a package with no license, unless
// scripts/ci/notices/allowlist.json names it with a reason; docs/builds.md
// describes the rules. Prints NOTICES_PASS or NOTICES_FAIL and exits 0 or 1
// (2 for a usage error). Nothing is written when it fails.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllowlist, render, resolveCandidates } from "./notices-core.mts";
import { mavenCandidates, runGradlePoms, type NativeResult } from "./notices-maven.mts";
import { npmCandidates, type Platform } from "./notices-npm.mts";
import { podCandidates, podInputs } from "./notices-pods.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const noticesDir = join(repoRoot, "scripts", "ci", "notices");
// Standard license texts, from https://github.com/spdx/license-list-data.
const standardDir = join(noticesDir, "licenses");
const SPDX_VERSION = "3.29.0";

type Target = { label: string; title: string; app: string; platform?: Platform };

export const TARGETS: Record<string, Target> = {
  android: { label: "Android", title: "Daily Dispatch for Android", app: "app" },
  ios: { label: "iOS", title: "Daily Dispatch for iOS", app: "app" },
  web: { label: "web", title: "Daily Dispatch for the web", app: "app" },
  "linux-x64": { label: "Linux desktop", title: "Daily Dispatch desktop, Linux x64", app: "app/desktop", platform: { os: "linux", cpu: "x64" } },
  "darwin-arm64": { label: "macOS desktop", title: "Daily Dispatch desktop, macOS arm64", app: "app/desktop", platform: { os: "darwin", cpu: "arm64" } },
  "win32-x64": { label: "Windows desktop", title: "Daily Dispatch desktop, Windows x64", app: "app/desktop", platform: { os: "win32", cpu: "x64" } },
};

export const noticesFileName = (target: string): string => `THIRD_PARTY_NOTICES-${target}.txt`;

type Args = Record<string, string>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--") || argv[i + 1] === undefined) throw new Error(`bad argument: ${key}`);
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

const posix = (p: string): string => p.split("\\").join("/");

const COMMON = ["target", "out", "app-dir", "allowlist"];
// Options each target needs on top of the common ones.
const NATIVE: Record<string, string[]> = { android: ["gradle-poms"], ios: ["podfile-lock", "pods-acknowledgements"] };

const USAGE = `usage: node scripts/ci/generate-notices.mts --target TARGET --out DIR
  TARGET is one of ${Object.keys(TARGETS).join(", ")}
  android runs Gradle in app/android, or reads --gradle-poms FILE (a thirdPartyPoms report)
  ios reads app/ios after pod install, or --podfile-lock FILE and --pods-acknowledgements FILE
  --app-dir DIR and --allowlist FILE override the defaults, for tests`;

function usageProblem(args: Args): string | undefined {
  const target = args.target ?? "";
  if (!TARGETS[target]) return `unknown --target ${target || "(none)"}`;
  if (!args.out) return "--out is required";
  const native = NATIVE[target] ?? [];
  const unknown = Object.keys(args).find((k) => !COMMON.includes(k) && !native.includes(k));
  return unknown ? `--${unknown} does not apply to --target ${target}` : undefined;
}

// Maven modules for android, pods for ios, nothing for the other targets.
function nativeCandidates(target: string, args: Args, appDir: string): NativeResult {
  if (target === "android") {
    const init = join(noticesDir, "android-poms.init.gradle");
    return mavenCandidates(args["gradle-poms"] ? resolve(args["gradle-poms"]) : runGradlePoms(join(appDir, "android"), init));
  }
  if (target === "ios") {
    const inputs = podInputs(join(appDir, "ios"), args["podfile-lock"], args["pods-acknowledgements"]);
    return podCandidates(inputs.lock, inputs.acks);
  }
  return { candidates: [], covered: [], problems: [] };
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    args = { error: (e as Error).message };
  }
  const usage = args.error ?? usageProblem(args);
  if (usage) {
    console.error(`${usage}\n${USAGE}`);
    return 2;
  }
  const target = TARGETS[args.target];
  const appDir = resolve(args["app-dir"] ?? join(repoRoot, target.app));
  const allowFile = resolve(args.allowlist ?? join(noticesDir, "allowlist.json"));
  const allowlist = loadAllowlist(allowFile, Object.keys(TARGETS));
  const allow = { entries: allowlist.entries.filter((e) => e.targets.includes(args.target)), dir: dirname(allowFile) };
  const npm = npmCandidates(appDir, target.platform);
  let native: NativeResult;
  try {
    native = nativeCandidates(args.target, args, appDir);
  } catch (e) {
    console.log(`FAIL ${args.target}: ${(e as Error).message}`);
    console.log("NOTICES_FAIL");
    return 1;
  }
  const standard = new Set(readdirSync(standardDir).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)));
  const resolved = resolveCandidates([...npm.candidates, ...native.candidates], { allow, target: args.target, standard });
  const problems = [...allowlist.problems, ...npm.problems, ...native.problems, ...resolved.problems].sort();
  for (const p of problems) console.log(`FAIL ${p}`);
  if (problems.length) {
    console.log("NOTICES_FAIL");
    return 1;
  }
  const of = (source: string) => resolved.notices.filter((n) => n.source === source).length;
  const lockLabel = posix(relative(repoRoot, join(appDir, "package-lock.json")));
  const sources = [`npm: production dependencies in ${lockLabel} (${count(of("npm"), "package")})`];
  if (args.target === "android") sources.push(`Maven: release runtime classpath of the Android app (${count(of("maven"), "module")})`);
  if (args.target === "ios") sources.push(`CocoaPods: the iOS app's Podfile.lock and acknowledgements (${count(of("cocoapods"), "pod")})`);
  const text = render({
    title: target.title,
    sources,
    notices: resolved.notices,
    covered: native.covered,
    standardDir,
    spdxVersion: SPDX_VERSION,
  });
  const file = join(resolve(args.out), noticesFileName(args.target));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${noticesFileName(args.target)}: ${count(resolved.notices.length, "package")}, ${native.covered.length} native modules inside npm packages`);
  console.log("NOTICES_PASS");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
