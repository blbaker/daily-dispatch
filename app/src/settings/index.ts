// React Native glue for the settings store: AsyncStorage, the build's
// default server, hooks for the screen, and the server every API client
// reads. Unit tests cover store.ts and api.ts; this file is covered by the
// typecheck and the browser run in e2e/settings.ts.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { createSettingsApi, effectiveServer, type Server } from "./api";
import { createSettingsStore } from "./store";
import type { SettingsState } from "./types";

export type { Server };
export type * from "./types";

/** The server this build was made with. Settings can override it per device. */
export const BUILD_SERVER: Server = {
  baseUrl: process.env.EXPO_PUBLIC_API_URL || "",
  apiKey: process.env.EXPO_PUBLIC_API_KEY || "",
};
/** The Boox build. E-ink mode is always on there. */
export const EINK_BUILD = String(process.env.EXPO_PUBLIC_EINK) === "true";

let latest: SettingsState | null = null;
export const settingsStore = createSettingsStore({
  storage: AsyncStorage,
  api: createSettingsApi({ server: () => serverNow() }),
});
const ready: Promise<SettingsState> = settingsStore.state().then((s) => (latest = s));
settingsStore.subscribe((s) => (latest = s));

/** The server to call right now. Before storage has loaded, the build's. */
export function serverNow(): Server {
  return effectiveServer(latest?.server ?? { apiUrl: null, apiKey: null }, BUILD_SERVER);
}

/** The server to call, once this device's saved override has loaded. */
export async function currentServer(): Promise<Server> {
  await ready;
  return serverNow();
}

/** The whole settings state, kept current. null until storage has loaded. */
export function useSettings(): SettingsState | null {
  const [state, setState] = useState<SettingsState | null>(latest);
  useEffect(() => {
    let live = true;
    void ready.then((s) => live && setState(s));
    const off = settingsStore.subscribe(setState);
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

/**
 * Syncs the podcast section on launch, each time the app comes back to the
 * foreground, and every minute while an edit is waiting, so an edit made
 * offline goes out once the server answers again.
 */
export function useSettingsSync(): void {
  useEffect(() => {
    void ready.then(() => settingsStore.sync());
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void settingsStore.sync();
    });
    const retry = setInterval(() => {
      if (latest?.sync.dirty) void settingsStore.sync();
    }, 60000);
    return () => {
      sub.remove();
      clearInterval(retry);
    };
  }, []);
}
