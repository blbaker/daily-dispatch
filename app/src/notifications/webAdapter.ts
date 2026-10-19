// Web Push in the browser: a service worker (public/sw.js) plus a
// PushManager subscription signed for the server's VAPID public key.
// The browser objects are passed in as WebEnv, so tests can use fakes.
import type { PushApi } from "./api";
import { targetFromData, targetFromQuery } from "./target";
import type { AdapterEvents, Credential, Permission, PushAdapter } from "./types";

interface SubscriptionLike {
  options?: { applicationServerKey?: ArrayBuffer | null };
  unsubscribe(): Promise<boolean>;
  toJSON(): unknown;
}

interface RegistrationLike {
  pushManager: {
    getSubscription(): Promise<SubscriptionLike | null>;
    subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<SubscriptionLike>;
  };
}

type MessageHandler = (e: { data: unknown }) => void;

export interface WebEnv {
  serviceWorker?: {
    register(url: string, o?: { scope: string }): Promise<unknown>;
    ready: Promise<RegistrationLike>;
    addEventListener(type: "message", fn: MessageHandler): void;
    removeEventListener(type: "message", fn: MessageHandler): void;
  };
  Notification?: { permission: string; requestPermission(): Promise<string> };
  hasPushManager: boolean;
  location: { search: string; pathname: string };
  history?: { replaceState(data: null, title: string, url: string): void };
}

export function browserEnv(): WebEnv {
  const g = globalThis as any;
  return {
    serviceWorker: g.navigator?.serviceWorker,
    Notification: g.Notification,
    hasPushManager: typeof g.PushManager !== "undefined",
    location: g.location ?? { search: "", pathname: "/" },
    history: g.history,
  };
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

export function createWebAdapter(opts: { env?: WebEnv; api: PushApi; swUrl?: string }): PushAdapter {
  const env = opts.env ?? browserEnv();
  const swUrl = opts.swUrl ?? "/sw.js";

  return {
    channel: "webpush",
    platform: "web",

    async permission(prompt): Promise<Permission> {
      if (!env.serviceWorker || !env.Notification || !env.hasPushManager) return "unsupported";
      let p = env.Notification.permission;
      if (p === "default") {
        if (!prompt) return "prompt";
        p = await env.Notification.requestPermission();
      }
      if (p === "granted") return "granted";
      return p === "denied" ? "denied" : "prompt";
    },

    async credential(): Promise<Credential> {
      const sw = env.serviceWorker!;
      await sw.register(swUrl, { scope: "/" });
      const reg = await sw.ready;
      const config = await opts.api.pushConfig();
      const vapid = config.webpush.vapidPublicKey;
      if (!config.webpush.enabled || !vapid) {
        throw new Error("Web Push is off on the server: it has no VAPID key yet (docs/push-setup.md)");
      }
      const key = base64UrlToBytes(vapid);
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
        // Subscribed under an older key pair: the server cannot sign for it.
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      return { subscription: sub.toJSON() };
    },

    listen(events: AdapterEvents) {
      // A tap with no window open loads the app with ?edition=<id> or ?episode=<id>.
      const initial = targetFromQuery(env.location.search);
      if (initial) {
        events.open(initial);
        env.history?.replaceState(null, "", env.location.pathname);
      }
      const onMessage: MessageHandler = (e) => {
        const msg = e.data as { type?: string; data?: unknown } | null;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "dd-open") {
          const t = targetFromData(msg.data);
          if (t) events.open(t);
        } else if (msg.type === "dd-push") {
          events.receive((msg.data ?? {}) as Record<string, string>);
        }
      };
      env.serviceWorker?.addEventListener("message", onMessage);
      return () => env.serviceWorker?.removeEventListener("message", onMessage);
    },
  };
}
