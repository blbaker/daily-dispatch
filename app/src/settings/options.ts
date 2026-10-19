// Choices and labels for the Settings screen's pickers, plus the small time
// helpers the Daily podcast section needs. Pure functions, no React Native.

export interface Option {
  id: string;
  label: string;
  sub: string;
}
export interface VoiceOption extends Option {
  paid: boolean;
}

/** ScriptWriter ids from packages/daily-dispatch/src/writers/registry.ts. */
export const WRITERS: Option[] = [
  { id: "command", label: "Command", sub: "Runs a CLI you choose, such as claude -p. The default" },
  { id: "anthropic", label: "Anthropic", sub: "Claude through the API · paid" },
  { id: "openai", label: "OpenAI", sub: "GPT through the API · paid" },
  { id: "ollama", label: "Ollama", sub: "A model on your own machine · free" },
];

/** VoiceProvider ids from packages/daily-dispatch/src/voices/registry.ts. */
export const VOICES: VoiceOption[] = [
  { id: "elevenlabs", label: "ElevenLabs", sub: "Text to Dialogue, both hosts in one pass · paid", paid: true },
  { id: "openai", label: "OpenAI", sub: "Text to speech, one host at a time · paid", paid: true },
  { id: "google", label: "Google Gemini", sub: "Multi-speaker text to speech · paid", paid: true },
  { id: "polly", label: "Amazon Polly", sub: "Neural voices · paid", paid: true },
  { id: "azure", label: "Azure AI Speech", sub: "Neural voices · paid", paid: true },
  { id: "local", label: "Local server", sub: "Any OpenAI-compatible TTS, such as Kokoro · free", paid: false },
];

// Built-in voices whose id is their name. ElevenLabs voice ids are opaque
// strings tied to an account's voice library, so it has no list here; the
// picker takes a pasted id instead.
const CATALOG: Record<string, string[]> = {
  openai: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"],
  google: ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"],
  polly: ["Joanna", "Matthew", "Ruth", "Stephen", "Danielle", "Gregory"],
  azure: [
    "en-US-AvaMultilingualNeural", "en-US-AndrewMultilingualNeural", "en-US-JennyNeural",
    "en-US-GuyNeural", "en-US-AriaNeural", "en-US-DavisNeural",
  ],
  local: ["af_heart", "af_bella", "af_nicole", "am_michael", "am_adam", "bf_emma", "bm_george"],
};

export function voiceCatalog(provider: string): string[] {
  return CATALOG[provider] ?? [];
}

export function labelFor(options: Option[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? id;
}

/** "17:45" -> { clock: "5:45", ampm: "PM" } */
export function formatTime(hhmm: string): { clock: string; ampm: string } {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { clock: `${h12}:${String(m).padStart(2, "0")}`, ampm: h < 12 ? "AM" : "PM" };
}

/** Every half hour of the day, plus `current` when it falls between them. */
export function timeSlots(current: string): string[] {
  const slots: string[] = [];
  for (let i = 0; i < 48; i++) slots.push(`${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
  if (!slots.includes(current)) slots.push(current);
  return slots.sort();
}

const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Berlin", "Asia/Kolkata",
  "Asia/Tokyo", "Australia/Sydney", "UTC",
];

/** The saved zone, then this device's zone, then a short list of common ones. */
export function timeZones(device: string | undefined, current: string): string[] {
  const out: string[] = [];
  for (const z of [current, device, ...ZONES]) if (z && !out.includes(z)) out.push(z);
  return out;
}

/** "today, Mon Oct 19" or "tomorrow, Tue Oct 20", reckoned in `timeZone`. "" for a bad zone. */
export function nextEpisode(nowMs: number, time: string, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
  } catch {
    return "";
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const nowHm = `${String(get("hour")).padStart(2, "0")}:${String(get("minute")).padStart(2, "0")}`;
  const today = nowHm < time;
  // The zone's calendar date, as a UTC midnight, so adding a day and
  // printing it never crosses a zone boundary.
  const day = Date.UTC(get("year"), get("month") - 1, get("day") + (today ? 0 : 1));
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
  }).format(new Date(day)).replace(",", "");
  return `${today ? "today" : "tomorrow"}, ${label}`;
}

/** Hosts in speaker order (S1, S2), padded to two. */
export function hostList(hostVoices: Record<string, string>): { name: string; voice: string }[] {
  const list = Object.entries(hostVoices).map(([name, voice]) => ({ name, voice }));
  for (let i = list.length; i < 2; i++) list.push({ name: `Host ${i + 1}`, voice: "" });
  return list;
}

/**
 * Sets one host's voice, keeping every name and the order of the rest. The
 * backend maps key order to speakers, so a host with no voice is left out;
 * the screen only offers Host 2 once Host 1 has a voice.
 */
export function withHostVoice(hostVoices: Record<string, string>, index: number, voice: string): Record<string, string> {
  const hosts = hostList(hostVoices);
  hosts[index] = { ...hosts[index], voice };
  const out: Record<string, string> = {};
  for (const h of hosts) if (h.voice) out[h.name] = h.voice;
  return out;
}
