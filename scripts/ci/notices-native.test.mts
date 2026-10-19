import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixture, MIT_TEXT, run } from "./notices-fixture.mts";
import { spdxForPom } from "./notices-maven.mts";
import { parseAcknowledgements, parsePodfileLock } from "./notices-pods.mts";

const pom = (body: string) => `<?xml version="1.0"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n${body}\n</project>\n`;
const licenses = (name: string, url = "") => `<licenses><license><name>${name}</name><url>${url}</url></license></licenses>`;

test("POM license names map to SPDX ids; unknown names stay as written", () => {
  const cases: [string, string, string][] = [
    ["The Apache Software License, Version 2.0", "http://www.apache.org/licenses/LICENSE-2.0.txt", "Apache-2.0"],
    ["Apache-2", "https://github.com/facebook/soloader/blob/main/LICENSE", "Apache-2.0"],
    ["APACHE-2", "", "Apache-2.0"],
    ["", "https://www.apache.org/licenses/LICENSE-2.0.txt", "Apache-2.0"],
    ["MIT license", "", "MIT"],
    ["The MIT License", "", "MIT"],
    ["BSD License", "https://example.org/LICENSE", "BSD License"],
    ["Apache License 1.1", "", "Apache License 1.1"],
  ];
  for (const [name, url, want] of cases) assert.equal(spdxForPom({ name, url }), want, name || url);
});

function androidFixture(allow: unknown[] = []) {
  const f = fixture([{ name: "expo-font", license: "MIT", files: { LICENSE: MIT_TEXT } }], allow);
  const cache = join(f.root, "gradle-cache");
  mkdirSync(cache);
  const local = join(f.app, "node_modules", "expo-font", "local-maven-repo");
  mkdirSync(local, { recursive: true });
  const poms: [string, string, string][] = [
    ["module", "androidx.core:core:1.13.1", pom(`<organization><name>The Android Open Source Project</name></organization>${licenses("The Apache Software License, Version 2.0", "http://www.apache.org/licenses/LICENSE-2.0.txt")}`)],
    ["module", "com.example:child:2.0", pom("<parent><groupId>com.example</groupId><artifactId>parent</artifactId><version>7</version></parent>")],
    ["parent", "com.example:parent:7", pom(`<!-- <licenses><license><name>GPL</name></license></licenses> -->${licenses("MIT License")}<developers><developer><name>Ex &amp; Co</name></developer></developers>`)],
    ["module", "com.parse.bolts:bolts-tasks:1.4.0", pom(licenses("BSD License"))],
  ];
  const lines = poms.map(([role, coord, xml]) => {
    const file = join(cache, `${coord.replaceAll(":", "_")}.pom`);
    writeFileSync(file, xml);
    return `${role}\t${coord}\t${file}`;
  });
  const fontPom = join(local, "expo.modules.font-14.0.12.pom");
  writeFileSync(fontPom, pom(""));
  lines.push(`module\thost.exp.exponent:expo.modules.font:14.0.12\t${fontPom}`, "module\tcom.example:nopom:1.0\t-");
  const report = join(f.root, "poms.tsv");
  writeFileSync(report, `${lines.join("\n")}\n`);
  return { f, report };
}

test("android: Maven modules get their POM license, inherited from a parent POM when needed", () => {
  const { f, report } = androidFixture([
    { source: "maven", name: "com.parse.bolts:bolts-tasks", version: "1.4.0", targets: ["android"], reason: "POM says only BSD License." },
    { source: "maven", name: "com.example:nopom", version: "1.0", targets: ["android"], reason: "Test module." },
  ]);
  const r = run(f, "android", ["--gradle-poms", report]);
  assert.equal(r.status, 0, r.stdout);
  const text = readFileSync(join(f.out, "THIRD_PARTY_NOTICES-android.txt"), "utf8");
  assert.ok(text.includes(
    "maven: androidx.core:core 1.13.1\nLicense: Apache-2.0\nLicense in the POM: The Apache Software License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0.txt). Copyright holder named in the POM: The Android Open Source Project.\n",
  ), text);
  assert.ok(text.includes("maven: com.example:child 2.0\nLicense: MIT\nLicense in the POM: MIT License. Copyright holder named in the POM: Ex & Co.\n"));
  assert.match(text, /\n {2}maven host\.exp\.exponent:expo\.modules\.font 14\.0\.12, part of npm expo-font\n/);
  assert.match(text, /Maven: release runtime classpath of the Android app \(4 modules\)/);
});

test("android: an unknown POM license or a module without a POM fails unless allowlisted", () => {
  const { f, report } = androidFixture();
  const r = run(f, "android", ["--gradle-poms", report]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL maven com\.parse\.bolts:bolts-tasks 1\.4\.0: no license text found, and no standard text for "BSD License"$/m);
  assert.match(r.stdout, /^FAIL maven com\.example:nopom 1\.0: no license declared$/m);
});

test("--gradle-poms is refused for other targets; android with no native project says how to make one", () => {
  const { f, report } = androidFixture();
  assert.equal(run(f, "web", ["--gradle-poms", report]).status, 2);
  const r = run(f, "android");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL android: no Gradle project at .*android; run npx expo prebuild --platform android in app\/ first$/m);
});

const PODFILE_LOCK = `PODS:
  - boost (1.84.0)
  - EXConstants (18.0.14):
    - ExpoModulesCore
  - "React-Core/Default (0.81.0)":
    - glog
  - React-Core (0.81.0):
    - React-Core/Default (= 0.81.0)
  - SocketRocket (0.7.1)
  - Mystery (1.0)

DEPENDENCIES:
  - boost (from \`../node_modules/react-native/third-party-podspecs/boost.podspec\`)

SPEC REPOS:
  trunk:
    - SocketRocket

EXTERNAL SOURCES:
  boost:
    :podspec: "../node_modules/react-native/third-party-podspecs/boost.podspec"
  EXConstants:
    :path: "../node_modules/expo-constants/ios"
  React-Core:
    :path: "../node_modules/react-native/"

SPEC CHECKSUMS:
  boost: 0123456789abcdef

COCOAPODS: 1.16.2
`;

const ack = (title: string, text: string, license?: string) =>
  `<dict><key>FooterText</key><string>${text}</string>${license ? `<key>License</key><string>${license}</string>` : ""}<key>Title</key><string>${title}</string><key>Type</key><string>PSGroupSpecifier</string></dict>`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>PreferenceSpecifiers</key><array>
${ack("Acknowledgements", "This application makes use of the following third party libraries:")}
${ack("boost", "Boost Software License - Version 1.0", "Boost Software License")}
${ack("SocketRocket", "Copyright &lt;c&gt; 2016-present, Facebook &amp; Co.", "BSD")}
<dict><key>FooterText</key><string>Generated by CocoaPods - https://cocoapods.org</string><key>Title</key><string/><key>Type</key><string>PSGroupSpecifier</string></dict>
</array><key>Title</key><string>Acknowledgements</string></dict></plist>
`;

test("an empty Gradle report fails instead of writing an Android file with no Maven section", () => {
  const f = fixture([{ name: "x", license: "MIT", files: { LICENSE: MIT_TEXT } }]);
  const report = join(f.root, "empty.tsv");
  writeFileSync(report, "");
  const r = run(f, "android", ["--gradle-poms", report]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL maven: the Gradle report lists no modules$/m);
});

test("ios with no pod install output says where it looked", () => {
  const f = fixture([]);
  const r = run(f, "ios");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FAIL ios: no .*Podfile\.lock; run npx expo prebuild --platform ios \(it runs pod install\) on macOS first$/m);
});

test("Podfile.lock: root pods with versions, and where each came from", () => {
  const lock = parsePodfileLock(PODFILE_LOCK);
  assert.deepEqual([...lock.pods.entries()], [["boost", "1.84.0"], ["EXConstants", "18.0.14"], ["React-Core", "0.81.0"], ["SocketRocket", "0.7.1"], ["Mystery", "1.0"]]);
  assert.deepEqual(lock.paths.get("EXConstants"), "../node_modules/expo-constants/ios");
  assert.equal(lock.paths.has("boost"), false, "a :podspec source is downloaded, not part of an npm package");
});

test("acknowledgements plist: title, license type and decoded text per pod", () => {
  const acks = parseAcknowledgements(PLIST);
  assert.deepEqual([...acks.keys()], ["boost", "SocketRocket"]);
  assert.deepEqual(acks.get("SocketRocket"), { license: "BSD", text: "Copyright <c> 2016-present, Facebook & Co." });
});

test("ios: pods built from npm packages are listed as part of them; a pod with no acknowledgement fails", () => {
  const f = fixture([{ name: "expo-constants", license: "MIT", files: { LICENSE: MIT_TEXT } }], [{ source: "cocoapods", name: "Mystery", version: "1.0", targets: ["ios"], reason: "Test pod." }]);
  writeFileSync(join(f.root, "Podfile.lock"), PODFILE_LOCK);
  writeFileSync(join(f.root, "acks.plist"), PLIST);
  const args = ["--podfile-lock", join(f.root, "Podfile.lock"), "--pods-acknowledgements", join(f.root, "acks.plist")];
  const r = run(f, "ios", args);
  assert.equal(r.status, 0, r.stdout);
  const text = readFileSync(join(f.out, "THIRD_PARTY_NOTICES-ios.txt"), "utf8");
  assert.ok(text.includes("cocoapods: SocketRocket 0.7.1\nLicense: BSD\n\nCopyright <c> 2016-present, Facebook & Co.\n"), text);
  assert.match(text, /\n {2}cocoapods EXConstants 18\.0\.14, part of npm expo-constants\n {2}cocoapods React-Core 0\.81\.0, part of npm react-native\n/);
  // Without the two options it reads app/ios, as CI does after pod install.
  const support = join(f.app, "ios", "Pods", "Target Support Files", "Pods-Fixture");
  mkdirSync(support, { recursive: true });
  writeFileSync(join(f.app, "ios", "Podfile.lock"), PODFILE_LOCK);
  writeFileSync(join(support, "Pods-Fixture-acknowledgements.plist"), PLIST);
  assert.equal(run(f, "ios").status, 0);
  writeFileSync(f.allowlist, JSON.stringify({ packages: [] }));
  const failed = run(f, "ios", args);
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^FAIL cocoapods Mystery 1\.0: no license declared$/m);
});
