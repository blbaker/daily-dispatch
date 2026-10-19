// The notifications module's one interface. It picks the platform adapter
// for Platform.OS, runs the registration flow (permission, credential,
// POST /devices), and fans adapter events out to the app. Desktop builds
// also run the poller here. No react-native imports, so it runs under
// unit tests; src/notifications/index.ts wires in the real adapters.
import type { PushApi } from "./api";
import { createPoller, type Poller, type Timers } from "./poller";
import { channelFor } from "./select";
import type {
  Channel, FeedNotification, KeyValueStore, NotificationStatus, OpenTarget, PushAdapter, PushData,
} from "./types";

export const DEVICE_KEY = "dd.push.deviceId";

export interface NotificationsOptions {
  os: string;
  adapters: Record<Channel, () => PushAdapter>;
  api: PushApi;
  storage: KeyValueStore;
  timers?: Timers;
  pollMs?: number;
}

export interface Notifications {
  readonly channel: Channel;
  status(): NotificationStatus;
  onStatus(fn: (s: NotificationStatus) => void): () => void;
  /** Registers this device. Asks for permission only when prompt is true. */
  start(opts?: { prompt?: boolean }): Promise<NotificationStatus>;
  /** start() with the permission prompt. Call it from a user's tap. */
  enable(): Promise<NotificationStatus>;
  stop(): void;
  onOpen(fn: (t: OpenTarget) => void): () => void;
  onReceive(fn: (d: PushData) => void): () => void;
  /** Poll channel: a notification the OS could not show, for an in-app banner. */
  onBanner(fn: (n: FeedNotification) => void): () => void;
}

function listeners<T>() {
  const set = new Set<(v: T) => void>();
  return {
    add(fn: (v: T) => void) {
      set.add(fn);
      return () => void set.delete(fn);
    },
    emit(v: T) {
      for (const fn of set) fn(v);
    },
    get size() {
      return set.size;
    },
  };
}

export function createNotifications(opts: NotificationsOptions): Notifications {
  const channel = channelFor(opts.os);
  const { api, storage } = opts;
  let adapter: PushAdapter | null = null;
  let unlisten: (() => void) | null = null;
  let poller: Poller | null = null;
  let current: NotificationStatus = { channel, state: "off" };
  let pendingOpen: OpenTarget | null = null;
  const status = listeners<NotificationStatus>();
  const open = listeners<OpenTarget>();
  const receive = listeners<PushData>();
  const banner = listeners<FeedNotification>();

  const setStatus = (s: NotificationStatus) => {
    current = s;
    status.emit(s);
    return s;
  };
  const getAdapter = () => (adapter ??= opts.adapters[channel]());

  function listen(a: PushAdapter) {
    if (unlisten || !a.listen) return;
    unlisten = a.listen({
      open(t) {
        if (open.size) open.emit(t);
        else pendingOpen = t;
      },
      receive: (d) => receive.emit(d),
    });
  }

  async function register(a: PushAdapter, prompt: boolean): Promise<NotificationStatus> {
    const perm = await a.permission(prompt);
    if (perm === "unsupported") return { channel, state: "unsupported" };
    if (perm === "prompt") return { channel, state: "needs-permission" };
    if (perm === "denied") return { channel, state: "denied" };
    let cred;
    try {
      cred = await a.credential();
    } catch (e) {
      return { channel, state: "error", detail: e instanceof Error ? e.message : String(e) };
    }
    try {
      const deviceId = await api.registerDevice({ platform: a.platform, kind: channel, ...cred });
      await storage.setItem(DEVICE_KEY, deviceId);
      return { channel, state: "registered", deviceId };
    } catch (e) {
      return { channel, state: "error", detail: `register failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  function startPoller(a: PushAdapter) {
    if (poller) return;
    poller = createPoller({
      api,
      storage,
      timers: opts.timers,
      intervalMs: opts.pollMs,
      deviceId: () => current.deviceId ?? null,
      reregister: async () => {
        const s = setStatus(await register(a, false));
        return s.deviceId ?? null;
      },
      show: async (n) => {
        const shown = a.show ? await a.show(n).catch(() => false) : false;
        if (!shown) banner.emit(n);
      },
    });
    poller.start();
  }

  async function start({ prompt = false }: { prompt?: boolean } = {}) {
    if (!api.configured) return setStatus({ channel, state: "error", detail: "API not configured" });
    const a = getAdapter();
    listen(a);
    const s = setStatus(await register(a, prompt));
    if (s.state === "registered" && channel === "poll") startPoller(a);
    return s;
  }

  return {
    channel,
    status: () => current,
    onStatus: status.add,
    start,
    enable: () => start({ prompt: true }),
    stop() {
      unlisten?.();
      unlisten = null;
      poller?.stop();
      poller = null;
    },
    onOpen(fn) {
      const off = open.add(fn);
      if (pendingOpen) {
        const t = pendingOpen;
        pendingOpen = null;
        fn(t);
      }
      return off;
    },
    onReceive: receive.add,
    onBanner: banner.add,
  };
}
