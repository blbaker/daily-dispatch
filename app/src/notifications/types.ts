// Types shared by the notifications module. No runtime code here, so tests
// and every platform file can import it freely.

/** How this install receives notifications. */
export type Channel = "expo" | "webpush" | "poll";

/** The `platform` value POST /devices expects. */
export type DevicePlatform = "ios" | "android" | "web" | "desktop";

/** The three switches a user controls. Mirrors /settings `notifications`. */
export interface NotificationPrefs {
  enabled: boolean;
  newEdition: boolean;
  newEpisode: boolean;
}

export interface PrefsState {
  prefs: NotificationPrefs;
  /** Epoch ms of the last local change, or null if never changed here. */
  updatedAt: number | null;
  /** True while a local change has not reached PUT /settings yet. */
  dirty: boolean;
}

/** What a tap on a notification should open. */
export type OpenTarget = { kind: "edition"; id: string } | { kind: "episode"; id: string };

/** The `data` object the backend puts in every push and notification row. */
export interface PushData {
  type?: string;
  id?: string;
  path?: string;
}

/** One row of GET /notifications/since. */
export interface FeedNotification {
  id: string;
  event: string;
  title: string;
  body: string;
  data: PushData;
  createdAt: string;
}

export type Permission = "granted" | "denied" | "prompt" | "unsupported";

export type StatusState =
  | "off" // not started yet
  | "unsupported" // this browser or build cannot receive notifications
  | "needs-permission" // the user has not been asked yet
  | "denied" // the user said no
  | "registered" // the backend knows this device
  | "error"; // something failed; see detail

export interface NotificationStatus {
  channel: Channel;
  state: StatusState;
  deviceId?: string;
  detail?: string;
}

/** Credentials POST /devices accepts for a channel. */
export type Credential = { token: string } | { subscription: unknown };

/** Callbacks a platform adapter calls when the user interacts. */
export interface AdapterEvents {
  open(target: OpenTarget): void;
  receive(data: PushData): void;
}

/** The per-platform part of the module. */
export interface PushAdapter {
  readonly channel: Channel;
  readonly platform: DevicePlatform;
  /** The current permission. Asks the user first only when prompt is true. */
  permission(prompt: boolean): Promise<Permission>;
  /** The token or subscription to register. Throws with a readable message. */
  credential(): Promise<Credential>;
  /** Subscribes to taps and foreground deliveries. Returns an unsubscribe. */
  listen?(events: AdapterEvents): () => void;
  /** Poll channel only: show one notification natively. False means "not shown". */
  show?(n: FeedNotification): Promise<boolean>;
}

/** Minimal async key-value store; AsyncStorage satisfies it. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
