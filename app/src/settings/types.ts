// Types for the Settings screen's store. No runtime code, so the store, its
// tests and the React Native glue can all import this file.
import type { KeyValueStore } from "../notifications/types";

export type { KeyValueStore };

/** The `podcast` section of backend /settings (docs/push-setup.md). */
export interface PodcastSettings {
  enabled: boolean;
  /** "HH:MM", 24-hour, in `timezone`. */
  time: string;
  /** IANA time zone name. */
  timezone: string;
  /** VoiceProvider adapter id, for example "elevenlabs". */
  voiceProvider: string;
  /** ScriptWriter adapter id, for example "command". */
  scriptWriter: string;
  /** Host name -> provider voice id. Key order maps to speakers S1, S2. */
  hostVoices: Record<string, string>;
}

export const TEXT_SCALES = [0.875, 1, 1.125, 1.25] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/** Per-device reading options. Never sent to the backend. */
export interface ReadingSettings {
  textScale: TextScale;
  /** Black and white, no photos, no motion. Forced on in the Boox build. */
  eink: boolean;
}

/**
 * Per-device server overrides. null means "use the value this build was
 * made with" (EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY).
 */
export interface ServerSettings {
  apiUrl: string | null;
  apiKey: string | null;
}

/** Where the podcast section stands against the backend. */
export interface PodcastSync {
  /** Epoch ms of the last podcast edit on this device, null if none. */
  updatedAt: number | null;
  /** True while that edit has not reached PUT /settings. */
  dirty: boolean;
  /** The podcast section as the backend last had it, to spot remote edits. */
  base: PodcastSettings | null;
  /** Epoch ms of the last successful sync. */
  syncedAt: number | null;
  /** Why the last sync failed, or null. */
  error: string | null;
}

export interface SettingsState {
  podcast: PodcastSettings;
  reading: ReadingSettings;
  server: ServerSettings;
  sync: PodcastSync;
}

/** What GET and PUT /settings return, reduced to the parts the app syncs. */
export interface RemoteSettings {
  podcast: PodcastSettings;
  /** ISO time of the backend's last PUT, or null. */
  updatedAt: string | null;
}

export interface SettingsApi {
  get(): Promise<RemoteSettings>;
  putPodcast(podcast: PodcastSettings): Promise<RemoteSettings>;
}

/** This build's version for Settings > About. */
export interface BuildInfo {
  version: string;
  build: string;
  /** "Phone build", "Boox e-ink build", ... */
  kind: string;
}
