import type { ProviderContext } from '../context.ts';
import type { Turn, VoiceMap } from '../types.ts';

/** What a provider can do, used to plan requests and estimate cost before any call. */
export interface VoiceCapabilities {
  /** One request can voice several speakers (ElevenLabs Text-to-Dialogue). */
  multiSpeaker: boolean;
  /** Upper bound on the characters sent in one request. */
  maxCharsPerRequest: number;
  /** Unique voices allowed in one request; 1 when multiSpeaker is false. */
  maxVoicesPerRequest: number;
  /** Audio tags ("laughs") passed through; the rest are stripped before sending. */
  supportedTags: 'all' | readonly string[];
  /** Estimated US dollars per character sent. 0 for free or local engines. */
  costPerChar: number;
}

export interface SynthesisRequest {
  /** Already filtered to the provider's supported tags. */
  turns: readonly Turn[];
  voices: VoiceMap;
}

export interface SynthesisResult {
  /** Encoded audio, MP3 unless the provider says otherwise. */
  audio: Uint8Array;
  /** Characters the provider says it billed, when it reports them. */
  billedChars?: number;
}

export interface VoiceProvider {
  readonly name: string;
  /** Paid providers default to a dry run unless the caller confirms. */
  readonly paid: boolean;
  /** Env var holding the API key, if the provider needs one. */
  readonly keyEnv?: string;
  readonly capabilities: VoiceCapabilities;
  /** Where the costPerChar number comes from, printed with every estimate. */
  readonly costSource: string;
  /** Capabilities for a specific voice map, when it changes them (per-turn fallback). */
  capabilitiesFor?(voices: VoiceMap): VoiceCapabilities;
  /** Everything that changes the audio for this request; hashed for the chunk cache. */
  requestKey(req: SynthesisRequest): unknown;
  synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult>;
  /** Fail before spending anything if the account cannot cover `chars`. */
  preflight?(chars: number): Promise<void>;
}

export type VoiceFactory = (ctx: ProviderContext) => VoiceProvider;

export function effectiveCapabilities(provider: VoiceProvider, voices: VoiceMap): VoiceCapabilities {
  return provider.capabilitiesFor?.(voices) ?? provider.capabilities;
}
