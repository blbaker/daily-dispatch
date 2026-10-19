// Desktop (Impeller) build of updates.ts. Metro picks this file over
// updates.ts when bundling for the "impeller" platform.
//
// The phone build updates itself by downloading an APK and handing it to
// Android's installer, which needs expo-application, expo-file-system and
// expo-intent-launcher. None of that applies on macOS, Linux or Windows: the
// desktop app ships as a release archive and is updated by replacing that
// archive. So this module keeps the same exports and reports "no update",
// which keeps the update banner hidden. It never touches the network.

export type Release = {
  versionCode: number;
  versionName: string;
  notes: string;
  url: string;
  size: number;
};

export function currentVersionCode(): number {
  return 0;
}

export async function checkForUpdate(): Promise<Release | null> {
  return null;
}

export async function isDownloaded(_rel: Release): Promise<boolean> {
  return false;
}

export async function downloadUpdate(
  _rel: Release,
  _onProgress: (fraction: number) => void,
): Promise<string> {
  throw new Error("In-app updates are not available on desktop. Download the new release instead.");
}

export async function installUpdate(_path: string): Promise<void> {
  throw new Error("In-app updates are not available on desktop. Download the new release instead.");
}

export async function cleanupOldDownloads(): Promise<void> {}
