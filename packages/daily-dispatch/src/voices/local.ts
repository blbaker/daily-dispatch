import { DispatchError, isDispatchError } from '../errors.ts';
import { readAudio, sendJson } from '../http.ts';
import type { SynthesisRequest, VoiceFactory, VoiceProvider } from './types.ts';

/** Kokoro-FastAPI's documented address; any OpenAI-compatible server works. */
export const DEFAULT_LOCAL_TTS_URL = 'http://127.0.0.1:8880/v1';

/**
 * Any server that speaks OpenAI's POST /v1/audio/speech: Kokoro-FastAPI,
 * openedai-speech, LocalAI and others. The voice entry's `id` is whatever the
 * server calls its voices ("af_bella" on Kokoro). It runs on your own
 * hardware, so it is free and never needs --confirm.
 *
 *   LOCAL_TTS_URL      base URL including /v1 (default http://127.0.0.1:8880/v1)
 *   LOCAL_TTS_MODEL    model name (default "kokoro")
 *   LOCAL_TTS_API_KEY  sent as a bearer token, only if the server wants one
 */
export const createLocalVoice: VoiceFactory = (ctx): VoiceProvider => {
  const base = (ctx.env['LOCAL_TTS_URL']?.trim() || DEFAULT_LOCAL_TTS_URL).replace(/\/+$/, '');
  const model = ctx.model ?? (ctx.env['LOCAL_TTS_MODEL']?.trim() || 'kokoro');
  const key = ctx.env['LOCAL_TTS_API_KEY']?.trim();

  const body = (req: SynthesisRequest): Record<string, unknown> => {
    const [turn, extra] = req.turns;
    const voice = turn === undefined ? undefined : req.voices[turn.speaker];
    if (turn === undefined || extra !== undefined || voice === undefined) {
      throw new DispatchError('invalid-input', 'local text-to-speech takes exactly one turn with a known voice');
    }
    return { model, voice: voice.id, input: turn.text, response_format: 'mp3' };
  };

  return {
    name: 'local',
    paid: false,
    capabilities: {
      multiSpeaker: false,
      maxCharsPerRequest: 4000,
      maxVoicesPerRequest: 1,
      supportedTags: [],
      costPerChar: 0,
    },
    costSource: 'runs on your own machine',
    requestKey: (req) => ({ base, ...body(req) }),
    async synthesize(req, signal) {
      const json = body(req);
      const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
      try {
        const res = await sendJson(
          `${base}/audio/speech`,
          { headers, body: json },
          { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'local', keyEnv: 'LOCAL_TTS_API_KEY', ...(signal ? { signal } : {}) },
        );
        return { audio: await readAudio(res, 'local') };
      } catch (e) {
        if (isDispatchError(e, 'network')) {
          throw new DispatchError('network', `${e.message}. Is the TTS server running? Set LOCAL_TTS_URL if it is not at ${DEFAULT_LOCAL_TTS_URL}.`);
        }
        throw e;
      }
    },
  };
};
