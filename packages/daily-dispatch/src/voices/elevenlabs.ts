import { DispatchError } from '../errors.ts';
import { readAudio, readJson, requireKey, sendJson } from '../http.ts';
import type { HttpOptions } from '../http.ts';
import type { VoiceMap } from '../types.ts';
import type { SynthesisRequest, VoiceCapabilities, VoiceFactory, VoiceProvider } from './types.ts';

const API = 'https://api.elevenlabs.io';
const KEY = 'ELEVENLABS_API_KEY';
const FORMAT = 'output_format=mp3_44100_128';
const STABILITY = 0.5;
const SEED = 1979;

const DIALOGUE: VoiceCapabilities = {
  multiSpeaker: true,
  // The API documents about 2,000 characters as the reliable ceiling per
  // dialogue request; 1,900 leaves room and matches the production script.
  maxCharsPerRequest: 1900,
  maxVoicesPerRequest: 10,
  supportedTags: 'all',
  // $0.08 per 1,000 characters for Eleven v4 on the pay-as-you-go API.
  costPerChar: 0.00008,
};

/** Text-to-Dialogue takes one model and one settings object for every speaker. */
const needsPerTurn = (voices: VoiceMap): boolean =>
  Object.values(voices).some((v) => v.settings !== undefined || v.model !== undefined);

/**
 * ElevenLabs. Text-to-Dialogue voices several speakers per request and keeps
 * their timing and audio tags. When a voice in the map has its own model or
 * voice settings, which dialogue cannot express, every turn goes through the
 * single-voice text-to-speech endpoint instead.
 */
export const createElevenLabsVoice: VoiceFactory = (ctx): VoiceProvider => {
  const model = ctx.model ?? 'eleven_v4';
  const http = (signal?: AbortSignal): HttpOptions => ({
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
    provider: 'elevenlabs',
    keyEnv: KEY,
    ...(signal ? { signal } : {}),
  });

  const body = (req: SynthesisRequest): { path: string; json: Record<string, unknown> } => {
    if (!needsPerTurn(req.voices)) {
      return {
        path: `/v1/text-to-dialogue?${FORMAT}`,
        json: {
          model_id: model,
          settings: { stability: STABILITY },
          seed: SEED,
          inputs: req.turns.map((t) => ({ text: t.text, voice_id: req.voices[t.speaker]?.id ?? '' })),
        },
      };
    }
    const [turn, extra] = req.turns;
    const voice = turn === undefined ? undefined : req.voices[turn.speaker];
    if (turn === undefined || extra !== undefined || voice === undefined) {
      throw new DispatchError('invalid-input', 'elevenlabs per-turn mode takes exactly one turn with a known voice');
    }
    return {
      path: `/v1/text-to-speech/${encodeURIComponent(voice.id)}?${FORMAT}`,
      json: { text: turn.text, model_id: voice.model ?? model, voice_settings: { stability: STABILITY, ...voice.settings }, seed: SEED },
    };
  };

  return {
    name: 'elevenlabs',
    paid: true,
    keyEnv: KEY,
    capabilities: DIALOGUE,
    costSource: 'Eleven v4 API price, elevenlabs.io/pricing/api, checked 2026-10-19; plan credits cost less per character',
    capabilitiesFor: (voices) =>
      needsPerTurn(voices) ? { ...DIALOGUE, multiSpeaker: false, maxVoicesPerRequest: 1 } : DIALOGUE,
    requestKey: (req) => body(req),
    async synthesize(req, signal) {
      const { path, json } = body(req);
      const key = requireKey(ctx.env, KEY, 'elevenlabs');
      const res = await sendJson(`${API}${path}`, { headers: { 'xi-api-key': key }, body: json }, http(signal));
      const billed = Number(res.headers.get('character-cost') ?? Number.NaN);
      const audio = await readAudio(res, 'elevenlabs');
      return Number.isFinite(billed) ? { audio, billedChars: billed } : { audio };
    },
    async preflight(chars) {
      const key = requireKey(ctx.env, KEY, 'elevenlabs');
      const res = await sendJson(`${API}/v1/user/subscription`, { method: 'GET', headers: { 'xi-api-key': key } }, http());
      const sub = (await readJson(res, 'elevenlabs')) as { character_count?: number; character_limit?: number };
      const left = (sub.character_limit ?? 0) - (sub.character_count ?? 0);
      if (chars > left) {
        const n = (x: number): string => x.toLocaleString('en-US');
        throw new DispatchError('budget', `elevenlabs: this episode needs up to ${n(chars)} characters and the account has ${n(left)} left`);
      }
    },
  };
};
