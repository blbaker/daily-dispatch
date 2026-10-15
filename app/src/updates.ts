// Self-hosted in-app updates (sideloaded app, so no Play in-app update API).
// Flow: ask the API for the latest release -> compare with this build's
// versionCode -> download the APK into the app's cache with progress ->
// hand it to Android's package installer. Android only; no-op on web.
import { Platform } from "react-native";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

const BASE = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");
const KEY = process.env.EXPO_PUBLIC_API_KEY || "";
const VARIANT = String(process.env.EXPO_PUBLIC_EINK) === "true" ? "eink" : "phone";
const FLAG_GRANT_READ_URI_PERMISSION = 1;

export type Release = {
  versionCode: number;
  versionName: string;
  notes: string;
  url: string; // short-lived presigned download URL
  size: number; // bytes
};

export function currentVersionCode(): number {
  return Number(Application.nativeBuildVersion || 0);
}

const apkPath = (vc: number) => `${FileSystem.cacheDirectory}daily-dispatch-${vc}.apk`;

/** Latest release if it is newer than this build, else null. Never throws. */
export async function checkForUpdate(): Promise<Release | null> {
  if (Platform.OS !== "android" || !BASE || !KEY) return null;
  try {
    const res = await fetch(`${BASE}/app/latest?variant=${VARIANT}`, {
      headers: { "x-api-key": KEY },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rel: Release = await res.json();
    return rel.versionCode > currentVersionCode() ? rel : null;
  } catch {
    return null;
  }
}

/** True if this release's APK is already fully downloaded. */
export async function isDownloaded(rel: Release): Promise<boolean> {
  try {
    const info: any = await FileSystem.getInfoAsync(apkPath(rel.versionCode));
    return !!info.exists && (!rel.size || info.size === rel.size);
  } catch {
    return false;
  }
}

/** Download the APK (0..1 progress). Resolves with the local file path. */
export async function downloadUpdate(
  rel: Release,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const dest = apkPath(rel.versionCode);
  if (await isDownloaded(rel)) {
    onProgress(1);
    return dest;
  }
  const dl = FileSystem.createDownloadResumable(rel.url, dest, {}, (p) => {
    const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : rel.size;
    if (total > 0) onProgress(Math.min(1, p.totalBytesWritten / total));
  });
  const out = await dl.downloadAsync();
  if (!out || out.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new Error(`Download failed (HTTP ${out ? out.status : "?"})`);
  }
  if (!(await isDownloaded(rel))) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new Error("Download incomplete");
  }
  return dest;
}

/** Open Android's installer on the APK. Resolves only if the user comes back
 *  without installing (a successful update replaces and restarts the app). */
export async function installUpdate(path: string): Promise<void> {
  const uri = await FileSystem.getContentUriAsync(path);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: uri,
    type: "application/vnd.android.package-archive",
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

/** Delete downloaded APKs for versions at or below the running build. */
export async function cleanupOldDownloads(): Promise<void> {
  if (Platform.OS !== "android" || !FileSystem.cacheDirectory) return;
  try {
    const cur = currentVersionCode();
    const files = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
    for (const f of files) {
      const m = /^daily-dispatch-(\d+)\.apk$/.exec(f);
      if (m && Number(m[1]) <= cur) {
        await FileSystem.deleteAsync(FileSystem.cacheDirectory + f, { idempotent: true });
      }
    }
  } catch {
    /* best-effort */
  }
}
