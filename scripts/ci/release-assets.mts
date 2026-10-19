// Check the files a release run downloaded before they are attached to the
// GitHub Release, then write SHA256SUMS.txt next to them.
//
//   node scripts/ci/release-assets.mts DIR
//
// Every expected asset must be there exactly once, be non-empty and start
// with the right magic bytes, and nothing else may be in DIR. A release that
// is missing a platform fails here instead of shipping short.
// Prints RELEASE_ASSETS_PASS or RELEASE_ASSETS_FAIL and exits 0 or 1.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Kind = "zip" | "gzip";
type Expected = { label: string; pattern: RegExp; kind: Kind };

export const SUMS_FILE = "SHA256SUMS.txt";

export const EXPECTED: Expected[] = [
  { label: "Android phone APK", pattern: /^daily-dispatch-android-phone(-debug-signed)?\.apk$/, kind: "zip" },
  { label: "Android e-ink APK", pattern: /^daily-dispatch-android-eink(-debug-signed)?\.apk$/, kind: "zip" },
  { label: "iOS simulator app", pattern: /^daily-dispatch-ios-simulator\.tar\.gz$/, kind: "gzip" },
  { label: "web export", pattern: /^daily-dispatch-web\.tar\.gz$/, kind: "gzip" },
  { label: "Linux desktop", pattern: /^daily-dispatch-linux-x64\.tar\.gz$/, kind: "gzip" },
  { label: "macOS desktop", pattern: /^daily-dispatch-darwin-arm64\.tar\.gz$/, kind: "gzip" },
  { label: "Windows desktop", pattern: /^daily-dispatch-win32-x64\.zip$/, kind: "zip" },
];

const MAGIC: Record<Kind, Buffer> = {
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  gzip: Buffer.from([0x1f, 0x8b]),
};

export type AssetFile = { name: string; size: number; head: Buffer };

// Returns one line per problem; an empty list means the set is complete.
export function checkAssets(files: AssetFile[]): string[] {
  const problems: string[] = [];
  const claimed = new Set<string>();
  for (const want of EXPECTED) {
    const hits = files.filter((f) => want.pattern.test(f.name));
    if (hits.length !== 1) {
      problems.push(`${want.label}: expected 1 file matching ${want.pattern}, found ${hits.length}`);
    }
    for (const f of hits) {
      claimed.add(f.name);
      if (f.size === 0) problems.push(`${f.name}: empty file`);
      else if (!f.head.subarray(0, MAGIC[want.kind].length).equals(MAGIC[want.kind])) {
        problems.push(`${f.name}: not a ${want.kind} file (first bytes ${f.head.subarray(0, 4).toString("hex")})`);
      }
    }
  }
  for (const f of files) {
    if (!claimed.has(f.name) && f.name !== SUMS_FILE) problems.push(`${f.name}: not an expected release asset`);
  }
  return problems;
}

export function readAssets(dir: string): AssetFile[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const path = join(dir, e.name);
      return { name: e.name, size: statSync(path).size, head: readFileSync(path).subarray(0, 8) };
    });
}

// Same format as `sha256sum`, so `sha256sum -c SHA256SUMS.txt` checks it.
export function sha256Sums(dir: string, names: string[]): string {
  return [...names]
    .sort()
    .map((n) => `${createHash("sha256").update(readFileSync(join(dir, n))).digest("hex")}  ${n}\n`)
    .join("");
}

function main(): number {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/ci/release-assets.mts DIR");
    return 2;
  }
  const files = readAssets(resolve(dir)).filter((f) => f.name !== SUMS_FILE);
  const problems = checkAssets(files);
  for (const f of files) console.log(`asset ${f.name} ${f.size} bytes`);
  for (const p of problems) console.log(`FAIL ${p}`);
  if (problems.length) {
    console.log("RELEASE_ASSETS_FAIL");
    return 1;
  }
  writeFileSync(join(resolve(dir), SUMS_FILE), sha256Sums(resolve(dir), files.map((f) => f.name)));
  console.log(`wrote ${SUMS_FILE}`);
  console.log("RELEASE_ASSETS_PASS");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
