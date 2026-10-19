import { DispatchError } from '../errors.ts';
import { readAudio, requireKey, sendJson } from '../http.ts';
import { signV4 } from './sigv4.ts';
import type { Env } from '../context.ts';
import type { SynthesisRequest, VoiceFactory, VoiceProvider } from './types.ts';

const KEY = 'AWS_ACCESS_KEY_ID';
const SECRET = 'AWS_SECRET_ACCESS_KEY';
const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;

/** US dollars per million characters, aws.amazon.com/polly/pricing. */
const PRICE_PER_M: Readonly<Record<string, number>> = { standard: 4, neural: 16, 'long-form': 100, generative: 30 };

function region(env: Env): string {
  const r = env['AWS_REGION']?.trim() || env['AWS_DEFAULT_REGION']?.trim();
  if (!r) throw new DispatchError('no-key', 'polly needs a region: set AWS_REGION (for example us-east-1).');
  if (!REGION.test(r)) throw new DispatchError('usage', `polly: "${r}" does not look like an AWS region such as us-east-1`);
  return r;
}

/**
 * Amazon Polly SynthesizeSpeech, one turn per request, signed with SigV4 by
 * hand so the package does not pull in the AWS SDK. The voice entry's `id`
 * is a Polly voice id ("Matthew", "Ruth"). `--voice-model` picks the engine:
 * neural (default), generative, long-form or standard; each voice supports
 * only some engines.
 *
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN (optional)
 *   AWS_REGION or AWS_DEFAULT_REGION
 */
export const createPollyVoice: VoiceFactory = (ctx): VoiceProvider => {
  const engine = ctx.model ?? 'neural';
  const price = PRICE_PER_M[engine];
  if (price === undefined) {
    throw new DispatchError('usage', `polly: unknown engine "${engine}". Use one of: ${Object.keys(PRICE_PER_M).join(', ')}`);
  }

  const body = (req: SynthesisRequest): Record<string, string> => {
    const [turn, extra] = req.turns;
    const voice = turn === undefined ? undefined : req.voices[turn.speaker];
    if (turn === undefined || extra !== undefined || voice === undefined) {
      throw new DispatchError('invalid-input', 'polly takes exactly one turn with a known voice');
    }
    // Key order matters only for the test vector; Polly accepts any order.
    return { Engine: engine, OutputFormat: 'mp3', Text: turn.text, TextType: 'text', VoiceId: voice.id };
  };

  const checkConfig = (): void => {
    requireKey(ctx.env, KEY, 'polly');
    requireKey(ctx.env, SECRET, 'polly');
    region(ctx.env);
  };

  return {
    name: 'polly',
    paid: true,
    keyEnv: KEY,
    capabilities: {
      multiSpeaker: false,
      // SynthesizeSpeech takes at most 3,000 billed characters per request.
      maxCharsPerRequest: 3000,
      maxVoicesPerRequest: 1,
      supportedTags: [],
      costPerChar: price / 1_000_000,
    },
    costSource: `Polly ${engine} voices, $${price} per million characters, aws.amazon.com/polly/pricing, checked 2026-10-19`,
    checkConfig,
    requestKey: (req) => body(req),
    async synthesize(req, signal) {
      const payload = JSON.stringify(body(req));
      checkConfig();
      const r = region(ctx.env);
      const url = `https://polly.${r}.amazonaws.com/v1/speech`;
      const token = ctx.env['AWS_SESSION_TOKEN']?.trim();
      const creds = { accessKeyId: ctx.env[KEY]!.trim(), secretAccessKey: ctx.env[SECRET]!.trim(), ...(token ? { sessionToken: token } : {}) };
      const signed = signV4({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: payload }, creds, {
        region: r,
        service: 'polly',
        now: (ctx.now ?? (() => new Date()))(),
      });
      // fetch sets Host itself from the URL, which is the value that was signed.
      const { host: _host, ...headers } = signed;
      const res = await sendJson(
        url,
        { headers, raw: payload },
        { fetchImpl: ctx.fetchImpl, sleep: ctx.sleep, provider: 'polly', keyEnv: `${KEY} / ${SECRET}`, ...(signal ? { signal } : {}) },
      );
      const billed = Number(res.headers.get('x-amzn-requestcharacters') ?? Number.NaN);
      const audio = await readAudio(res, 'polly');
      return Number.isFinite(billed) ? { audio, billedChars: billed } : { audio };
    },
  };
};
