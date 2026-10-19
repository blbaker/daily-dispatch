import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkAssets, readAssets, sha256Sums, SUMS_FILE, type AssetFile } from "./release-assets.mts";

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const GZIP = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]);
const script = fileURLToPath(new URL("./release-assets.mts", import.meta.url));

function complete(): AssetFile[] {
  const zip = (name: string): AssetFile => ({ name, size: 100, head: ZIP });
  const gz = (name: string): AssetFile => ({ name, size: 100, head: GZIP });
  return [
    zip("daily-dispatch-android-phone-debug-signed.apk"),
    zip("daily-dispatch-android-eink-debug-signed.apk"),
    gz("daily-dispatch-ios-simulator.tar.gz"),
    gz("daily-dispatch-web.tar.gz"),
    gz("daily-dispatch-linux-x64.tar.gz"),
    gz("daily-dispatch-darwin-arm64.tar.gz"),
    zip("daily-dispatch-win32-x64.zip"),
  ];
}

function tempDir(files: AssetFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), "release-assets-"));
  for (const f of files) writeFileSync(join(dir, f.name), Buffer.concat([f.head, Buffer.alloc(f.size)]));
  return dir;
}

test("a complete set passes, with debug-signed or release-signed APKs", () => {
  assert.deepEqual(checkAssets(complete()), []);
  const release = complete().map((f) => ({ ...f, name: f.name.replace("-debug-signed", "") }));
  assert.deepEqual(checkAssets(release), []);
});

test("a missing platform fails and is named", () => {
  const problems = checkAssets(complete().filter((f) => !f.name.includes("win32")));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Windows desktop: expected 1 file .* found 0$/);
});

test("two APKs for one variant fail", () => {
  const files = [...complete(), { name: "daily-dispatch-android-phone.apk", size: 100, head: ZIP }];
  assert.match(checkAssets(files)[0], /^Android phone APK: expected 1 file .* found 2$/);
});

test("an unexpected file fails", () => {
  assert.deepEqual(checkAssets([...complete(), { name: "notes.txt", size: 1, head: ZIP }]), [
    "notes.txt: not an expected release asset",
  ]);
});

test("an empty file fails", () => {
  const files = complete().map((f) => (f.name.endsWith("web.tar.gz") ? { ...f, size: 0 } : f));
  assert.deepEqual(checkAssets(files), ["daily-dispatch-web.tar.gz: empty file"]);
});

test("a tar archive named .zip fails the magic-byte check", () => {
  const tar = Buffer.from("daily-dispatch-win32-x64/\0\0\0");
  const files = complete().map((f) => (f.name.endsWith(".zip") ? { ...f, head: tar } : f));
  assert.match(checkAssets(files)[0], /^daily-dispatch-win32-x64\.zip: not a zip file/);
});

test("sha256Sums matches the sha256sum format", () => {
  const dir = tempDir([{ name: "b.apk", size: 3, head: ZIP }, { name: "a.zip", size: 5, head: ZIP }]);
  const lines = sha256Sums(dir, ["b.apk", "a.zip"]).trimEnd().split("\n");
  assert.equal(lines.length, 2);
  const digest = createHash("sha256").update(readFileSync(join(dir, "a.zip"))).digest("hex");
  assert.equal(lines[0], `${digest}  a.zip`);
  assert.match(lines[1], /^[0-9a-f]{64} {2}b\.apk$/);
});

test("the CLI writes SHA256SUMS.txt for a complete set and exits 0", () => {
  const dir = tempDir(complete());
  const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RELEASE_ASSETS_PASS/);
  assert.equal(readFileSync(join(dir, SUMS_FILE), "utf8").trimEnd().split("\n").length, 7);
  // A second run ignores the sums file it wrote.
  assert.equal(spawnSync(process.execPath, [script, dir]).status, 0);
  assert.equal(readAssets(dir).length, 8);
});

test("the CLI exits 1 and writes nothing for an incomplete set", () => {
  const dir = tempDir(complete().slice(1));
  const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL Android phone APK/);
  assert.match(r.stdout, /RELEASE_ASSETS_FAIL/);
  assert.ok(!readAssets(dir).some((f) => f.name === SUMS_FILE));
});
