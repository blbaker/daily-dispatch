// The push adapters each build can load.
//
// Metro bundles every require() it can see, even one inside a closure that
// never runs, so keeping expo-notifications out of the desktop bundle needs a
// separate file: adapters.impeller.ts replaces this one when bundling for the
// "impeller" platform.
import type { PushApi } from "./api";
import type { Channel, KeyValueStore, PushAdapter } from "./types";

export function adapterFactories(api: PushApi, storage: KeyValueStore): Record<Channel, () => PushAdapter> {
  // Required lazily so a platform never evaluates another platform's native modules.
  return {
    expo: () => (require("./nativeAdapter") as typeof import("./nativeAdapter")).createNativeAdapter(),
    webpush: () => (require("./webAdapter") as typeof import("./webAdapter")).createWebAdapter({ api }),
    poll: () => (require("./desktopAdapter") as typeof import("./desktopAdapter")).createDesktopAdapter(storage),
  };
}
