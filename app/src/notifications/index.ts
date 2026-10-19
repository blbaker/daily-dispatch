// Notifications on every platform, behind one interface.
//
//   iOS, Android (phone and e-ink): expo-notifications + Expo push tokens
//   web: service worker (public/sw.js) + Web Push subscription
//   desktop (Impeller): polls GET /notifications/since every 5 minutes
//
// App root: call useNotifications() once.
// Settings screen: useNotificationPrefs() (or get/set/subscribe) for the
// three switches, useNotificationStatus() for "is this device registered",
// and enableNotifications() behind a button; it shows the permission prompt,
// which browsers only allow from a click.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { currentServer, serverNow } from "../settings";
import { createPushApi } from "./api";
import { createNotifications, type Notifications } from "./controller";
import { DEFAULT_PREFS, createPrefsStore } from "./prefs";
import type {
  FeedNotification, NotificationPrefs, NotificationStatus, OpenTarget, PrefsState, PushData,
} from "./types";

export type { FeedNotification, NotificationPrefs, NotificationStatus, OpenTarget, PrefsState, PushData };
export { DEFAULT_PREFS };

// The server comes from Settings (or the build), read on every request.
const api = createPushApi({ baseUrl: () => serverNow().baseUrl, apiKey: () => serverNow().apiKey });
const storage = AsyncStorage;
const prefs = createPrefsStore({ api, storage });
let instance: Notifications | null = null;

// The adapters are required lazily so a platform never evaluates another
// platform's native modules.
function notifications(): Notifications {
  instance ??= createNotifications({
    os: Platform.OS,
    api,
    storage,
    adapters: {
      expo: () => (require("./nativeAdapter") as typeof import("./nativeAdapter")).createNativeAdapter(),
      webpush: () => (require("./webAdapter") as typeof import("./webAdapter")).createWebAdapter({ api }),
      poll: () => (require("./desktopAdapter") as typeof import("./desktopAdapter")).createDesktopAdapter(storage),
    },
  });
  return instance;
}

/* ---------- prefs: master, new edition, new episode ---------- */

export const getNotificationPrefs = (): Promise<NotificationPrefs> => prefs.get();
/** Prefs plus updatedAt (epoch ms) and whether a change is waiting to sync. */
export const getNotificationPrefsState = (): Promise<PrefsState> => prefs.state();
/** Saves locally right away, then sends to PUT /settings (retried later if offline). */
export const setNotificationPrefs = (patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> => prefs.set(patch);
/** Sends a pending change. Resolves true when the backend has everything. */
export const syncNotificationPrefs = (): Promise<boolean> => prefs.sync();
export const subscribeNotificationPrefs = (fn: (p: NotificationPrefs) => void): (() => void) => prefs.subscribe(fn);

export function useNotificationPrefs(): {
  prefs: NotificationPrefs | null;
  setPrefs: (patch: Partial<NotificationPrefs>) => Promise<NotificationPrefs>;
} {
  const [value, setValue] = useState<NotificationPrefs | null>(null);
  useEffect(() => {
    let live = true;
    void prefs.get().then((p) => live && setValue(p));
    const off = prefs.subscribe(setValue);
    return () => {
      live = false;
      off();
    };
  }, []);
  return { prefs: value, setPrefs: setNotificationPrefs };
}

/* ---------- device status and registration ---------- */

export const getNotificationStatus = (): NotificationStatus => notifications().status();
export const subscribeNotificationStatus = (fn: (s: NotificationStatus) => void): (() => void) =>
  notifications().onStatus(fn);
/** Asks for permission if needed and registers this device. Call from a tap. */
export const enableNotifications = (): Promise<NotificationStatus> => notifications().enable();

export function useNotificationStatus(): NotificationStatus {
  const [status, setStatus] = useState(getNotificationStatus);
  useEffect(() => subscribeNotificationStatus(setStatus), []);
  return status;
}

/* ---------- app wiring ---------- */

/** Opens an episode's audio in the system player. Never throws. */
export async function openEpisode(id: string): Promise<void> {
  try {
    const ep = await api.getEpisode(id);
    if (ep.audioUrl) await Linking.openURL(ep.audioUrl);
  } catch {
    // Offline or the episode is gone; the tap does nothing.
  }
}

/**
 * Registers this device and routes taps and deliveries to the app. Mount once
 * at the root. Native and desktop ask for permission on first launch when
 * notifications are on; the web waits for enableNotifications().
 */
export function useNotifications(handlers: { onOpen(t: OpenTarget): void; onReceive?(d: PushData): void }): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const n = notifications();
    const offOpen = n.onOpen((t) => ref.current.onOpen(t));
    const offReceive = n.onReceive((d) => ref.current.onReceive?.(d));
    void (async () => {
      await currentServer(); // registration needs this device's saved server
      const p = await prefs.get();
      await n.start({ prompt: p.enabled && n.channel !== "webpush" });
      await prefs.sync();
    })();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void prefs.sync();
    });
    return () => {
      offOpen();
      offReceive();
      sub.remove();
    };
  }, []);
}

/** Desktop without OS notifications: the latest one to show in-app, and a dismiss. */
export function useNotificationBanner(hideAfterMs = 12000): [FeedNotification | null, () => void] {
  const [note, setNote] = useState<FeedNotification | null>(null);
  const dismiss = useCallback(() => setNote(null), []);
  useEffect(() => notifications().onBanner(setNote), []);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(dismiss, hideAfterMs);
    return () => clearTimeout(t);
  }, [note, dismiss, hideAfterMs]);
  return [note, dismiss];
}
