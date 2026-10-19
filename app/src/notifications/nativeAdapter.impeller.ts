// Desktop (Impeller) build of nativeAdapter.ts. Metro picks this file over
// nativeAdapter.ts when bundling for the "impeller" platform.
//
// index.ts requires every adapter lazily, but Metro still resolves each
// require() when it bundles, so the expo-notifications and expo-constants
// imports in nativeAdapter.ts would fail the desktop bundle. Desktop never
// selects the expo channel (select.ts gives it "poll"), so this file only has
// to exist and say so if it is ever reached.
import type { PushAdapter } from "./types";

export function createNativeAdapter(): PushAdapter {
  throw new Error("Expo push is not available on desktop; the desktop build polls /notifications/since.");
}
