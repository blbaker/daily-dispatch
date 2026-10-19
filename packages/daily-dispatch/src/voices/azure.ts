import { DispatchError } from '../errors.ts';
import { readAudio, requireKey, sendJson } from '../http.ts';
import type { SynthesisRequest, VoiceFactory, VoiceProvider } from './types.ts';

const KEY = 'AZURE_SPEECH_KEY';
const REGION_ENV = 'AZURE_SPEECH_REGION';
const FORMAT = 'audio-24khz-96kbitrate-mono-mp3';

const XML: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => XML[c]!);

/** "de-DE-KatjaNeural" speaks de-DE; anything without a locale prefix falls back to en-US. */
const localeOf = (voice: string): string => /^([a-z]{2,3}-[A-Z]{2})-/.exec(voice)?.[1] ?? 'en-US';

/**
 * Azure AI Speech through the text-to-speech REST API. One request carries
 * an SSML document with a <voice> element per turn, so both hosts share a
 * request. The voice entry's `id` is an Azure voice name such as
 * "en-US-AvaMultilingualNeural". Keys are bound to a region, so the region
 * is required rather than guessed.
 *
 *   AZURE_SPEECH_KEY     the Speech resource key
 *   AZURE_SPEECH_REGION  the resource's region, for example eastus
 */
export const createAzureVoice: VoiceFactory = (ctx): VoiceProvider => {
  const region = (): string => {
    const r = ctx.env[REGION_ENV]?.trim();
    if (!r) throw new DispatchError('no-key', `azure needs the Speech resource's region: set ${REGION_ENV} (for example eastus).`);
    if (!/^[a-z0-9]+$/.test(r)) throw new DispatchError('usage', `azure: "${r}" does not look like an Azure region such as eastus`);
    return r;
  };

  const ssml = (req: SynthesisRequest): string => {
    const first = req.turns[0];
    const unknown = req.turns.find((t) => req.voices[t.speaker] === undefined);
    if (first === undefined || unknown !== undefined) {
      throw new DispatchError('invalid-input', 'azure takes at least one turn, each with a known voice');
    }
    const lang = localeOf(req.voices[first.speaker]!.id);
    const body = req.turns.map((t) => `<voice name='${esc(req.voices[t.speaker]!.id)}'>${esc(t.text)}</voice>`).join('');
    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>${body}</speak>`;
  };

  const checkConfig = (): void => {
    requireKey(ctx.env, KEY, 'azure');
    region();
  };

  return {
    name: 'azure',
    paid: true,
    keyEnv: KEY,
    capabilities: {
      multiSpeaker: true,
      // About three minutes of audio; one request may return up to ten.
      maxCharsPerRequest: 3000,
      maxVoicesPerRequest: 10,
      // The service allows 50 <voice> and <audio> elements per SSML document.
      maxTurnsPerRequest: 50,
      supportedTags: [],
      costPerChar: 0.000015,
    },
    costSource: 'Azure neural voices, $15 per million characters pay-as-you-go, azure.microsoft.com/pricing/details/speech, checked 2026-10-19',
    checkConfig,
    requestKey: (req) => ({ format: FORMAT, ssml: ssml(req) }),
    async synthesize(req, signal) {
      const doc = ssml(req);
      checkConfig();
      const res = await sendJson(
        `https://${region()}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          headers: {
            'ocp-apim-subscription-key': ctx.env[KEY]!.trim(),
            'content-type': 'application/ssml+xml',
            'x-microsoft-outputformat': FORMAT,
            'user-agent': 'daily-dispatch',
          },
          raw: doc,
        },
        { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'azure', keyEnv: `${KEY} and ${REGION_ENV}`, ...(signal ? { signal } : {}) },
      );
      return { audio: await readAudio(res, 'azure') };
    },
  };
};
