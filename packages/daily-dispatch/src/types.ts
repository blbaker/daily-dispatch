/** One story from a digest edition. Every fact in an episode comes from these. */
export interface Story {
  headline: string;
  source: string;
  summary: string;
  url: string;
}

/** One line of dialogue. `speaker` is a tag from the voice map, e.g. "S1". */
export interface Turn {
  speaker: string;
  text: string;
}

/** A run of turns that plays without a long pause. Chunks never cross segments. */
export interface Segment {
  title: string;
  turns: Turn[];
}

export interface Script {
  title: string;
  segments: Segment[];
}

export type SpeakerRole = 'host' | 'caller';

/**
 * One voice in voices.json. `id` means whatever the provider uses (an
 * ElevenLabs voice id, an OpenAI voice name). The optional fields are read
 * by the providers that support them and ignored by the rest.
 */
export interface VoiceEntry {
  id: string;
  /** Shown in the transcript and given to the script writer. */
  name: string;
  /** Defaults to "host" for tags like S1/S2 and "caller" for everything else. */
  role?: SpeakerRole;
  /** ElevenLabs: per-voice model. Forces per-turn text-to-speech. */
  model?: string;
  /** ElevenLabs: per-voice voice_settings. Forces per-turn text-to-speech. */
  settings?: Record<string, number | boolean>;
  /** How this voice should speak: OpenAI gpt-4o-mini-tts instructions, Gemini turn style. */
  instructions?: string;
}

/** Speaker tag -> voice. Tags are upper-case letters, digits and underscores. */
export type VoiceMap = Record<string, VoiceEntry>;
