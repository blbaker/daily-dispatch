import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TARGETS } from "./generate-notices.mts";
import { loadAllowlist } from "./notices-core.mts";
import { fixture, MIT_TEXT, run } from "./notices-fixture.mts";

const NOTICES = (f: { out: string }, target: string) => join(f.out, `THIRD_PARTY_NOTICES-${target}.txt`);

test("a package with no license fails the run, is named, and no file is written", () => {
  const f = fixture([
    { name: "has-license", license: "MIT", files: { LICENSE: MIT_TEXT } },
    { name: "no-license-pkg", version: "2.0.1" },
  ]);
  const r = run(f, "web");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^FAIL npm no-license-pkg 2\.0\.1: no license declared$/m);
  assert.match(r.stdout, /^NOTICES_FAIL$/m);
  assert.equal(existsSync(NOTICES(f, "web")), false);
});

test("each package is written with its name, version, license id and full license text", () => {
  const f = fixture([
    { name: "alpha", version: "1.2.3", license: "MIT", files: { "LICENSE.md": MIT_TEXT } },
    { name: "@scope/beta", version: "0.1.0", license: "ISC", files: { license: "ISC License\r\n\r\nCopyright Beta\r\n" } },
  ]);
  const r = run(f, "web");
  assert.equal(r.status, 0, r.stdout);
  const text = readFileSync(NOTICES(f, "web"), "utf8");
  assert.ok(text.startsWith("Third-party notices: "));
  assert.ok(text.includes(`npm: alpha 1.2.3\nLicense: MIT\n\n${MIT_TEXT}`), text);
  assert.ok(text.includes("npm: @scope/beta 0.1.0\nLicense: ISC\n\nISC License\n\nCopyright Beta\n"), "CRLF is normalized");
  assert.ok(text.indexOf("@scope/beta") < text.indexOf("npm: alpha"), "sorted by name");
});

test("an allowlisted package passes, with the reason and any text files the entry names", () => {
  const allow = [
    { source: "npm", name: "no-license-pkg", version: "2.0.1", targets: ["web"], reason: "Checked by hand: the README grants MIT.", license: "MIT", textFiles: ["no-license-pkg.txt"] },
  ];
  const f = fixture([{ name: "no-license-pkg", version: "2.0.1" }], allow, { "no-license-pkg.txt": "Text kept beside the allowlist.\n" });
  const r = run(f, "web");
  assert.equal(r.status, 0, r.stdout);
  const text = readFileSync(NOTICES(f, "web"), "utf8");
  assert.ok(text.includes("npm: no-license-pkg 2.0.1\nLicense: MIT\nAllowlisted: Checked by hand: the README grants MIT.\n\nText kept beside the allowlist.\n"), text);
});

test("an allowlist entry with no reason, or one that matches nothing, fails the run", () => {
  const noReason = fixture([{ name: "x", license: "MIT", files: { LICENSE: MIT_TEXT } }], [
    { source: "npm", name: "x", version: "1.0.0", targets: ["web"], reason: " " },
  ]);
  const r1 = run(noReason, "web");
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /^FAIL allowlist entry 0 \(x\): reason is required$/m);
  const stale = fixture([{ name: "x", license: "MIT", files: { LICENSE: MIT_TEXT } }], [
    { source: "npm", name: "x", version: "0.9.0", targets: ["web", "android"], reason: "Old version." },
  ]);
  const r2 = run(stale, "web");
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /^FAIL allowlist entry npm x 0\.9\.0 for web matched no package; update or remove it$/m);
});

test("a package with a license id but no license file gets the standard text for that id", () => {
  const f = fixture([
    { name: "bare-mit", license: "MIT", author: { name: "Bare Author" } },
    { name: "either", license: "(Apache-2.0 OR MIT)", author: "Either Author <e@example.com>" },
  ]);
  const r = run(f, "web");
  assert.equal(r.status, 0, r.stdout);
  const text = readFileSync(NOTICES(f, "web"), "utf8");
  assert.ok(text.includes("npm: bare-mit 1.0.0\nLicense: MIT\nThe package ships no license file. Copyright holder named by the package: Bare Author.\nIts license text is the standard MIT text under \"Standard license texts\" at the end of this file.\n"), text);
  assert.ok(text.includes("named by the package: Either Author <e@example.com>.\nIts license text is the standard Apache-2.0 text"), "first id with a text wins");
  assert.match(text, /\nStandard license texts\n[\s\S]*\nApache-2\.0\n-+\n\nApache License\n[\s\S]*\nMIT\n-+\n\nMIT License\n/);
});

test("a license id with no standard text, and no license file, fails", () => {
  const f = fixture([{ name: "odd", license: "LicenseRef-Odd" }]);
  const r = run(f, "web");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL npm odd 1\.0\.0: no license text found, and no standard text for "LicenseRef-Odd"$/m);
});

const engine = (os: string, cpu: string, installed: boolean) => ({
  name: `@x/engine-${os}-${cpu}`, license: "MIT", files: { LICENSE: MIT_TEXT }, optional: true, os: [os], cpu: [cpu], installed,
});

test("dev dependencies are left out, and OS-specific packages only count for their own desktop target", () => {
  const f = fixture([
    { name: "runtime", license: "MIT", files: { LICENSE: MIT_TEXT } },
    { name: "tooling", dev: true, installed: false },
    { name: "lightningcss-linux-x64-gnu", license: "MPL-2.0", optional: true, os: ["linux"], cpu: ["x64"], files: { LICENSE: "MPL" } },
    engine("linux", "x64", true),
    engine("win32", "x64", false),
  ]);
  const linux = run(f, "linux-x64");
  assert.equal(linux.status, 0, linux.stdout);
  const text = readFileSync(NOTICES(f, "linux-x64"), "utf8");
  assert.ok(text.includes("npm: @x/engine-linux-x64 1.0.0"));
  assert.ok(!text.includes("engine-win32") && !text.includes("tooling"));
  const web = run(f, "web");
  assert.equal(web.status, 0, web.stdout);
  const webText = readFileSync(NOTICES(f, "web"), "utf8");
  assert.ok(!webText.includes("engine-linux") && !webText.includes("lightningcss"), "build-host binaries never ship in the web build");
  const win = run(f, "win32-x64");
  assert.equal(win.status, 1);
  assert.match(win.stdout, /^FAIL npm @x\/engine-win32-x64 1\.0\.0: built for win32-x64 but not installed; generate this target on win32-x64 after npm ci$/m);
});

test("a missing required package, or one whose installed version differs from the lockfile, fails", () => {
  const f = fixture([
    { name: "gone", license: "MIT", installed: false },
    { name: "maybe", license: "MIT", optional: true, installed: false },
  ]);
  const r = run(f, "web");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL npm gone 1\.0\.0: in package-lock\.json but not installed; run npm ci first$/m);
  assert.doesNotMatch(r.stdout, /FAIL npm maybe/);
  const stale = fixture([{ name: "drift", version: "2.0.0", license: "MIT", files: { LICENSE: MIT_TEXT } }]);
  const manifest = join(stale.app, "node_modules", "drift", "package.json");
  writeFileSync(manifest, JSON.stringify({ name: "drift", version: "1.9.0", license: "MIT" }));
  const r2 = run(stale, "web");
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /^FAIL npm drift 2\.0\.0: node_modules has version 1\.9\.0; run npm ci first$/m);
});

test("the old licenses field counts, as a string or as a list of objects", () => {
  const f = fixture([
    { name: "plural-string", manifest: { licenses: "MIT" }, files: { LICENSE: MIT_TEXT } },
    { name: "plural-list", manifest: { licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }, files: { LICENSE: MIT_TEXT } },
  ]);
  const r = run(f, "web");
  assert.equal(r.status, 0, r.stdout);
  const text = readFileSync(NOTICES(f, "web"), "utf8");
  assert.ok(text.includes("npm: plural-string 1.0.0\nLicense: MIT\n"));
  assert.ok(text.includes("npm: plural-list 1.0.0\nLicense: (MIT OR Apache-2.0)\n"));
});

test("the output is byte-identical across runs and lockfile key order", () => {
  const f = fixture([
    { name: "zeta", license: "MIT", files: { LICENSE: MIT_TEXT } },
    { name: "alpha", license: "MIT" },
    { name: "mid", license: "ISC", files: { LICENSE: "ISC\r\n" }, path: "node_modules/zeta/node_modules/mid" },
  ]);
  assert.equal(run(f, "web").status, 0);
  const first = readFileSync(NOTICES(f, "web"));
  const lockFile = join(f.app, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  lock.packages = Object.fromEntries(Object.entries(lock.packages).reverse());
  writeFileSync(lockFile, JSON.stringify(lock));
  assert.equal(run(f, "web").status, 0);
  assert.ok(readFileSync(NOTICES(f, "web")).equals(first));
});

test("the repository allowlist is valid and every text file it names exists", () => {
  const file = fileURLToPath(new URL("./notices/allowlist.json", import.meta.url));
  const { entries, problems } = loadAllowlist(file, Object.keys(TARGETS));
  assert.deepEqual(problems, []);
  assert.ok(entries.length > 0);
  for (const target of ["linux-x64", "darwin-arm64", "win32-x64"]) {
    assert.ok(entries.some((e) => e.targets.includes(target) && e.textFiles?.includes("impeller-engine.txt")), `${target} engine note`);
  }
});
