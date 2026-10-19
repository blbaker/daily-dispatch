import { DispatchError } from '../errors.ts';
import { readJson, requireKey, sendJson } from '../http.ts';
import type { VoiceMap } from '../types.ts';
import type { SynthesisRequest, VoiceCapabilities, VoiceFactory, VoiceProvider } from './types.ts';

const URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const KEY = 'GEMINI_API_KEY';

const DIALOGUE: VoiceCapabilities = {
  multiSpeaker: true,
  // About three minutes of speech. The model caps output at 16,384 audio
  // tokens (about 11 minutes at 25 tokens per second), so this leaves room.
  maxCharsPerRequest: 3000,
  // Multi-speaker requests take at most two prebuilt voices.
  maxVoicesPerRequest: 2,
  // Gemini reads stage directions aloud; its own inline tags use <angle> brackets.
  supportedTags: [],
  // $9.00 per million audio tokens = $0.00225 per 10 s of audio. At about
  // 1,000 characters per minute that is 1.5 audio tokens per character, plus
  // a quarter text token at $0.50 per million: about $13.60 per million characters.
  costPerChar: 0.0000136,
};

/** Designed (voice_) and replicated (voice_, voicekey_) voices cannot share a multi-speaker request. */
const hasCustomVoice = (voices: VoiceMap): boolean => Object.values(voices).some((v) => /^voice(key)?_/.test(v.id));

/**
 * Gemini TTS through the Interactions API. Two hosts with prebuilt voices
 * ("Kore", "Puck") share one request; anything else goes one turn at a time.
 * A voice entry's `instructions` become the turn's `style`. Unary replies are
 * WAV with a RIFF header, which the episode assembly decodes like any MP3.
 */
export const createGoogleVoice: VoiceFactory = (ctx): VoiceProvider => {
  const model = ctx.model ?? 'gemini-3.8-flash-tts';

  const body = (req: SynthesisRequest): Record<string, unknown> => {
    const speakers = [...new Set(req.turns.map((t) => t.speaker))];
    const missing = speakers.filter((s) => req.voices[s] === undefined);
    if (req.turns.length === 0 || missing.length > 0 || speakers.length > 2) {
      throw new DispatchError('invalid-input', 'google text-to-speech takes one or two known speakers per request');
    }
    const multi = speakers.length === 2;
    const content = req.turns.map((t) => {
      const style = req.voices[t.speaker]?.instructions;
      return {
        type: 'text',
        text: t.text,
        annotations: [{ type: 'speech_metadata', ...(multi ? { speaker: t.speaker } : {}), ...(style ? { style } : {}) }],
      };
    });
    const speechConfig = multi
      ? { speakers: speakers.map((s) => ({ speaker: s, voice: req.voices[s]!.id })) }
      : [{ voice: req.voices[speakers[0]!]!.id }];
    return {
      model,
      input: [{ type: 'user_input', content }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: speechConfig },
    };
  };

  return {
    name: 'google',
    paid: true,
    keyEnv: KEY,
    capabilities: DIALOGUE,
    costSource: 'gemini-3.8-flash-tts list price through 2026-12-31 (doubles on 2027-01-01), ai.google.dev/gemini-api/docs/pricing, checked 2026-10-19',
    capabilitiesFor: (voices) => (hasCustomVoice(voices) ? { ...DIALOGUE, multiSpeaker: false, maxVoicesPerRequest: 1 } : DIALOGUE),
    requestKey: (req) => body(req),
    async synthesize(req, signal) {
      const json = body(req);
      const key = requireKey(ctx.env, KEY, 'google');
      const res = await sendJson(
        URL,
        { headers: { 'x-goog-api-key': key }, body: json },
        { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'google', keyEnv: KEY, ...(signal ? { signal } : {}) },
      );
      const reply = (await readJson(res, 'google')) as { steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }> };
      const audio = (reply.steps ?? [])
        .filter((s) => s.type === 'model_output')
        .flatMap((s) => s.content ?? [])
        .filter((c) => c.type === 'audio' && typeof c.data === 'string' && c.data !== '')
        .pop();
      if (audio?.data === undefined) throw new DispatchError('bad-response', 'google: the reply had no audio');
      return { audio: new Uint8Array(Buffer.from(audio.data, 'base64')) };
    },
  };
};
