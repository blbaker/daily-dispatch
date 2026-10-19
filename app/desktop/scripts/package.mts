// Package the desktop app for the machine this runs on.
//
//   node scripts/package.mts [--out DIR]
//
// Produces dist/daily-dispatch-<os>-<arch>/ plus an archive of it:
//   app/       the release JS bundle and its assets
//   engine/    the engine binary and the libraries next to it, copied from
//              the engine package npm installed for this OS and CPU
//   a launcher: daily-dispatch (Linux), Daily Dispatch.cmd (Windows), or a
//              "Daily Dispatch.app" bundle (macOS)
// The API URL and key are baked into the bundle from the shell or app/.env,
// exactly as for `npm run desktop`. Packages are per OS: the engine is
// native code, so build each one on (or for) its own OS.
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { appConfig, bundle, desktopRoot, engine } from "./lib.mts";

const argOut = process.argv.indexOf("--out");
const distDir = resolve(argOut > 0 ? process.argv[argOut + 1] : join(desktopRoot, "dist"));
const os = process.platform;
const name = `daily-dispatch-${os}-${process.arch}`;
const { name: appName, displayName, window } = appConfig();

// Engine flags shared by every launcher. Paths are filled in per OS.
function flags(bundlePath: string): string[] {
  return [
    "--window", "--bundle", bundlePath, "--app-name", appName, "--title", `"${displayName}"`,
    "--width", String(window.width), "--height", String(window.height), "--probe-banner", "off",
  ];
}

// Copy the engine's whole bin/ folder: the binary loads its libraries from
// its own directory (RUNPATH $ORIGIN, @loader_path, or the exe folder).
function copyEngine(dest: string): string {
  const { binary } = engine();
  cpSync(dirname(binary), dest, { recursive: true, verbatimSymlinks: true });
  return basename(binary);
}

function writeExecutable(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

// The bundle is built in a private temp folder (mode 0700); make it readable
// by everyone once it is in the package.
function adoptBundle(staging: string, dest: string): void {
  renameSync(staging, dest);
  chmodSync(dest, 0o755);
}

function packageLinux(root: string, bundleDir: string): void {
  adoptBundle(bundleDir, join(root, "app"));
  const exe = copyEngine(join(root, "engine"));
  writeExecutable(
    join(root, "daily-dispatch"),
    `#!/bin/sh\n# ${displayName} desktop launcher\nHERE="$(cd "$(dirname "$0")" && pwd)"\n` +
      `exec "$HERE/engine/${exe}" ${flags('"$HERE/app/index.impeller.bundle"').join(" ")} "$@"\n`,
  );
}

function packageWindows(root: string, bundleDir: string): void {
  adoptBundle(bundleDir, join(root, "app"));
  const exe = copyEngine(join(root, "engine"));
  const cmd = `@echo off\r\nrem ${displayName} desktop launcher\r\n` +
    `"%~dp0engine\\${exe}" ${flags('"%~dp0app\\index.impeller.bundle"').join(" ")} %*\r\n`;
  writeFileSync(join(root, `${displayName}.cmd`), cmd);
}

// A minimal macOS app bundle. It is not signed or notarized: that needs an
// Apple Developer account. Users of an unsigned download have to allow it in
// System Settings > Privacy & Security the first time.
function packageMac(root: string, bundleDir: string): void {
  const contents = join(root, `${displayName}.app`, "Contents");
  const resources = join(contents, "Resources");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  mkdirSync(resources, { recursive: true });
  adoptBundle(bundleDir, join(resources, "app"));
  const exe = copyEngine(join(resources, "engine"));
  const version = "1.0.0";
  writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>${displayName}</string>
  <key>CFBundleDisplayName</key><string>${displayName}</string>
  <key>CFBundleIdentifier</key><string>io.github.dailydispatch.desktop</string>
  <key>CFBundleExecutable</key><string>daily-dispatch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
  writeExecutable(
    join(contents, "MacOS", "daily-dispatch"),
    `#!/bin/sh\n# ${displayName} desktop launcher\nRES="$(cd "$(dirname "$0")/../Resources" && pwd)"\n` +
      `exec "$RES/engine/${exe}" ${flags('"$RES/app/index.impeller.bundle"').join(" ")} "$@"\n`,
  );
}

function archive(root: string): string {
  const win = os === "win32";
  const file = join(distDir, `${name}${win ? ".zip" : ".tar.gz"}`);
  const args = win ? ["-a", "-c", "-f", file, "-C", distDir, name] : ["-czf", file, "-C", distDir, name];
  const r = spawnSync("tar", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`tar failed (exit ${r.status})`);
  return file;
}

function main(): void {
  const root = join(distDir, name);
  mkdirSync(distDir, { recursive: true });
  // Never delete an earlier package; move it aside instead.
  for (const old of [root, `${root}.zip`, `${root}.tar.gz`]) {
    if (existsSync(old)) renameSync(old, join(distDir, `.previous-${Date.now()}-${basename(old)}`));
  }
  mkdirSync(root, { recursive: true });
  const staging = mkdtempSync(join(distDir, ".bundle-"));
  bundle({ outDir: staging });
  if (os === "linux") packageLinux(root, staging);
  else if (os === "win32") packageWindows(root, staging);
  else if (os === "darwin") packageMac(root, staging);
  else throw new Error(`no desktop engine for ${os}`);
  console.log(`package: ${root}`);
  console.log(`package: ${archive(root)}`);
}

main();
