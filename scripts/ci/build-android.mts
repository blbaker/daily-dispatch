// Build the phone and e-ink APKs from the generated Android project, then
// check them. Run it after `npx expo prebuild --platform android` in app/:
//
//   node scripts/ci/build-android.mts [--out DIR]
//
// Release signing: set ANDROID_KEYSTORE_FILE to a keystore path, plus
// ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD.
// Without ANDROID_KEYSTORE_FILE the APKs keep the generated project's debug
// signature and their file names end in -debug-signed.
//
// Prints APK_CHECK_PASS or APK_CHECK_FAIL and exits 0 or 1.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apkFileName, BUNDLE_ENTRY, checkApks, signerDns, zipEntries, type ApkFacts, type Signing } from "./apk.mts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const androidDir = join(repoRoot, "app", "android");
const argOut = process.argv.indexOf("--out");
const outDir = resolve(argOut > 0 ? process.argv[argOut + 1] : join(repoRoot, "app", "dist-android"));
const VARIANTS = [
  { name: "phone", eink: "false" },
  { name: "eink", eink: "true" },
];

function signing(): { signing: Signing; args: string[] } {
  const file = process.env.ANDROID_KEYSTORE_FILE;
  if (!file) return { signing: "debug", args: [] };
  const missing = ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`ANDROID_KEYSTORE_FILE is set but ${missing.join(", ")} is not`);
  if (!existsSync(file)) throw new Error(`ANDROID_KEYSTORE_FILE does not exist: ${file}`);
  // The Android Gradle plugin reads these "injected" signing properties (the
  // ones Android Studio passes for a signed build) and lets them override the
  // generated project's debug signing. They only take effect as -P arguments:
  // the same names set through ORG_GRADLE_PROJECT_* variables were ignored
  // and the APK came out debug-signed. checkApks catches that case.
  const p = "-Pandroid.injected.signing.";
  return {
    signing: "release",
    args: [
      `${p}store.file=${resolve(file)}`,
      `${p}store.password=${process.env.ANDROID_KEYSTORE_PASSWORD}`,
      `${p}key.alias=${process.env.ANDROID_KEY_ALIAS}`,
      `${p}key.password=${process.env.ANDROID_KEY_PASSWORD}`,
    ],
  };
}

function gradle(args: string[], env: NodeJS.ProcessEnv): void {
  const win = process.platform === "win32";
  const r = spawnSync(win ? "gradlew.bat" : "./gradlew", [...args, "--no-daemon"], {
    cwd: androidDir,
    env,
    stdio: "inherit",
    shell: win,
  });
  // Never echo args: they can hold the keystore passwords.
  if (r.status !== 0) throw new Error(`gradlew ${args[0]} failed (exit ${r.status})`);
}

// Newest build-tools that has apksigner.
function apksigner(): string {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_HOME is not set");
  const tools = join(sdk, "build-tools");
  const versions = readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const bin = join(tools, v, process.platform === "win32" ? "apksigner.bat" : "apksigner");
    if (existsSync(bin)) return bin;
  }
  throw new Error(`no apksigner under ${tools}`);
}

function main(): number {
  if (!existsSync(join(androidDir, "app", "build.gradle"))) {
    throw new Error("app/android is missing. Run `npx expo prebuild --platform android` in app/ first.");
  }
  const { signing: mode, args: signArgs } = signing();
  const signer = apksigner();
  mkdirSync(outDir, { recursive: true });
  console.log(`build-android: signing=${mode} out=${outDir}`);
  const apks: ApkFacts[] = [];
  for (const v of VARIANTS) {
    // Gradle does not track EXPO_PUBLIC_* as inputs of the JS bundle task, so
    // without --rerun the second variant would reuse the first one's bundle.
    // CI is dropped too: with CI set, `expo export:embed` skips the Metro cache
    // reset React Native asks for, and the second variant reuses transforms
    // with the first one's EXPO_PUBLIC_EINK inlined.
    const { CI: _ci, ...env } = process.env;
    gradle([":app:createBundleReleaseJsAndAssets", "--rerun", "assembleRelease", ...signArgs], {
      ...env,
      EXPO_PUBLIC_EINK: v.eink,
    });
    const file = join(outDir, apkFileName(v.name, mode));
    copyFileSync(join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk"), file);
    const verify = spawnSync(signer, ["verify", "--print-certs", file], { encoding: "utf8", shell: process.platform === "win32" });
    if (verify.status !== 0) throw new Error(`apksigner verify failed for ${file}:\n${verify.stderr}`);
    apks.push({ variant: v.name, file, entries: zipEntries(readFileSync(file)), signers: signerDns(verify.stdout) });
  }
  for (const apk of apks) {
    const crc = apk.entries.get(BUNDLE_ENTRY)?.crc32.toString(16) ?? "none";
    console.log(`apk ${apk.variant}: ${apk.file} bundle_crc32=${crc} signer="${apk.signers.join("; ")}"`);
  }
  const problems = checkApks(apks, mode);
  for (const p of problems) console.log(`FAIL ${p}`);
  console.log(problems.length ? "APK_CHECK_FAIL" : "APK_CHECK_PASS");
  return problems.length ? 1 : 0;
}

process.exitCode = main();
