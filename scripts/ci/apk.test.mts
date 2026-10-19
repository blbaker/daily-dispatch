import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32 } from "node:zlib";
import { apkFileName, BUNDLE_ENTRY, checkApks, isDebugCertificate, signerDns, zipEntries, type ApkFacts } from "./apk.mts";

// A minimal zip writer (stored entries only), enough to exercise the reader.
function makeZip(entries: { name: string; data: string }[], comment = ""): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const data = Buffer.from(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt32LE(crc32(data), 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(dir, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, cd, end, Buffer.from(comment)]);
}

// The DN of the debug keystore in the Expo template, as apksigner prints it.
const DEBUG = "CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US";
const RELEASE = "CN=Daily Dispatch, O=Example, C=US";

function apk(variant: string, bundle: string | null, signers: string[]): ApkFacts {
  const files = [{ name: "AndroidManifest.xml", data: "manifest" }];
  if (bundle !== null) files.push({ name: BUNDLE_ENTRY, data: bundle });
  return { variant, file: `${variant}.apk`, entries: zipEntries(makeZip(files)), signers };
}

test("zipEntries reads names, CRC-32 and sizes, with a trailing comment", () => {
  const entries = zipEntries(makeZip([{ name: "a.txt", data: "hello" }, { name: "dir/b.bin", data: "" }], "a comment"));
  assert.deepEqual([...entries.keys()], ["a.txt", "dir/b.bin"]);
  assert.equal(entries.get("a.txt")?.crc32, crc32(Buffer.from("hello")));
  assert.equal(entries.get("a.txt")?.size, 5);
  assert.equal(entries.get("dir/b.bin")?.size, 0);
});

test("zipEntries rejects a file that is not a zip", () => {
  assert.throws(() => zipEntries(Buffer.alloc(100, 7)), /not a zip file/);
});

test("signerDns reads every signer from apksigner output", () => {
  const out = [
    `Signer #1 certificate DN: ${DEBUG}`,
    "Signer #1 certificate SHA-256 digest: 00ff",
    `Signer #2 certificate DN: ${RELEASE}`,
  ].join("\n");
  assert.deepEqual(signerDns(out), [DEBUG, RELEASE]);
  assert.ok(isDebugCertificate(DEBUG));
  assert.ok(isDebugCertificate("CN=Android Debug, O=Android, C=US"), "Android SDK debug keystore");
  assert.ok(!isDebugCertificate(RELEASE));
  assert.ok(!isDebugCertificate("CN=Android Debugger Tools, O=Example, C=US"));
  assert.ok(!isDebugCertificate("CN=Example, OU=Android Debug, C=US"));
});

test("apkFileName marks debug-signed APKs", () => {
  assert.equal(apkFileName("eink", "debug"), "daily-dispatch-android-eink-debug-signed.apk");
  assert.equal(apkFileName("phone", "release"), "daily-dispatch-android-phone.apk");
});

test("checkApks passes two standalone, differently bundled APKs", () => {
  assert.deepEqual(checkApks([apk("phone", "p", [DEBUG]), apk("eink", "e", [DEBUG])], "debug"), []);
  assert.deepEqual(checkApks([apk("phone", "p", [RELEASE]), apk("eink", "e", [RELEASE])], "release"), []);
});

test("checkApks fails a release build signed with the debug certificate", () => {
  const problems = checkApks([apk("phone", "p", [DEBUG]), apk("eink", "e", [RELEASE])], "release");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /phone: signed with the public debug certificate/);
});

test("checkApks fails a debug build signed with something else", () => {
  assert.match(checkApks([apk("phone", "p", [DEBUG]), apk("eink", "e", [RELEASE])], "debug")[0], /eink: expected the debug/);
});

test("checkApks fails an APK with no signer", () => {
  assert.match(checkApks([apk("phone", "p", []), apk("eink", "e", [DEBUG])], "debug")[0], /phone: apksigner reported no signer/);
});

test("checkApks fails an APK without the JS bundle", () => {
  assert.match(checkApks([apk("phone", null, [DEBUG]), apk("eink", "e", [DEBUG])], "debug")[0], /phone: no assets/);
  assert.match(checkApks([apk("phone", "", [DEBUG]), apk("eink", "e", [DEBUG])], "debug")[0], /phone: no assets/);
});

test("checkApks fails when both variants carry the same bundle", () => {
  const problems = checkApks([apk("phone", "same", [DEBUG]), apk("eink", "same", [DEBUG])], "debug");
  assert.deepEqual(problems, ["phone and eink carry the same JS bundle; EXPO_PUBLIC_EINK did not reach it"]);
});

test("checkApks fails when a variant is missing", () => {
  assert.match(checkApks([apk("phone", "p", [DEBUG])], "debug")[0], /expected the phone and e-ink APKs, got 1/);
});
