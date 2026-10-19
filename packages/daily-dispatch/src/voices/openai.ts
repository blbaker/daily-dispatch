import { DispatchError } from '../errors.ts';
import { readAudio, requireKey, sendJson } from '../http.ts';
import type { SynthesisRequest, VoiceFactory, VoiceProvider } from './types.ts';

const URL = 'https://api.openai.com/v1/audio/speech';
const KEY = 'OPENAI_API_KEY';

/**
 * OpenAI text-to-speech, one request per turn. The voice entry's `id` is a
 * built-in voice name ("onyx", "coral") or a custom voice id ("voice_...");
 * `instructions` steers delivery on gpt-4o-mini-tts. Audio tags are
 * stripped before sending because this API would read them aloud.
 */
export const createOpenAIVoice: VoiceFactory = (ctx): VoiceProvider => {
  const model = ctx.model ?? 'gpt-4o-mini-tts';

  const body = (req: SynthesisRequest): Record<string, unknown> => {
    const [turn, extra] = req.turns;
    const voice = turn === undefined ? undefined : req.voices[turn.speaker];
    if (turn === undefined || extra !== undefined || voice === undefined) {
      throw new DispatchError('invalid-input', 'openai text-to-speech takes exactly one turn with a known voice');
    }
    return {
      model,
      voice: voice.id.startsWith('voice_') ? { id: voice.id } : voice.id,
      input: turn.text,
      response_format: 'mp3',
      ...(voice.instructions ? { instructions: voice.instructions } : {}),
    };
  };

  return {
    name: 'openai',
    paid: true,
    keyEnv: KEY,
    capabilities: {
      multiSpeaker: false,
      maxCharsPerRequest: 4096,
      maxVoicesPerRequest: 1,
      supportedTags: [],
      // About $15 per million characters (roughly $0.015 per minute of audio).
      costPerChar: 0.000015,
    },
    costSource: 'gpt-4o-mini-tts, about $0.015 per minute of audio per OpenAI, about $15 per million characters; checked 2026-10-19',
    requestKey: (req) => body(req),
    async synthesize(req, signal) {
      const json = body(req);
      const key = requireKey(ctx.env, KEY, 'openai');
      const res = await sendJson(
        URL,
        { headers: { authorization: `Bearer ${key}` }, body: json },
        { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'openai', keyEnv: KEY, ...(signal ? { signal } : {}) },
      );
      return { audio: await readAudio(res, 'openai') };
    },
  };
};
