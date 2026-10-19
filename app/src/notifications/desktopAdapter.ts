// Desktop (Impeller on macOS, Linux and Windows). There is no push service,
// so the controller polls /notifications/since and calls show() here. When
// the engine has its Notifications module, show() posts a real OS
// notification; otherwise it returns false and the app shows an in-app
// banner instead. The module's contract is documented in
// react-native-impeller-platform (docs/eng/notifications.md): methods
// requestPermission() and show(title, body, id, dataJson), and the
// "rniNotificationPress" event with {id, action, data} when one is clicked.
import { DeviceEventEmitter, TurboModuleRegistry, type TurboModule } from "react-native";
import { targetFromData } from "./target";
import type { AdapterEvents, Credential, FeedNotification, KeyValueStore, PushAdapter } from "./types";

export const INSTALL_ID_KEY = "dd.push.installId";
const PRESS_EVENT = "rniNotificationPress";

interface NativeNotifications extends TurboModule {
  requestPermission(): Promise<{ status: string; reason?: string }>;
  show(title: string, body: string, id: string, dataJson: string): Promise<{ status: string; reason?: string }>;
}

function newInstallId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = new Uint8Array(24);
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => alphabet[b & 63]).join("");
}

export function createDesktopAdapter(storage: KeyValueStore): PushAdapter {
  // get, not getEnforcing: an engine without the module falls back to banners.
  const native = TurboModuleRegistry.get<NativeNotifications>("Notifications");

  return {
    channel: "poll",
    platform: "desktop",

    async permission(prompt) {
      // Polling needs no permission; the banner fallback covers a "no" from the OS.
      if (native && prompt) await native.requestPermission().catch(() => undefined);
      return "granted";
    },

    async credential(): Promise<Credential> {
      let id = await storage.getItem(INSTALL_ID_KEY);
      if (!id) {
        id = newInstallId();
        await storage.setItem(INSTALL_ID_KEY, id);
      }
      return { token: id };
    },

    async show(n: FeedNotification) {
      if (!native) return false;
      const res = await native.show(n.title, n.body, `dd-${n.id}`, JSON.stringify(n.data ?? null));
      return res.status === "shown";
    },

    listen(events: AdapterEvents) {
      if (!native) return () => {};
      const sub = DeviceEventEmitter.addListener(PRESS_EVENT, (e: { data?: string }) => {
        let data: unknown = null;
        try {
          data = typeof e.data === "string" ? JSON.parse(e.data) : null;
        } catch {
          // The engine echoes what show() sent, so this is not expected.
        }
        const t = targetFromData(data);
        if (t) events.open(t);
      });
      return () => sub.remove();
    },
  };
}
