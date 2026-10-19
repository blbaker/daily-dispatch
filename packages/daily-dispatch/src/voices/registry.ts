import { DispatchError } from '../errors.ts';
import { createAzureVoice } from './azure.ts';
import { createElevenLabsVoice } from './elevenlabs.ts';
import { createGoogleVoice } from './google.ts';
import { createLocalVoice } from './local.ts';
import { createOpenAIVoice } from './openai.ts';
import { createPollyVoice } from './polly.ts';
import type { ProviderContext } from '../context.ts';
import type { VoiceFactory, VoiceProvider } from './types.ts';

/** Every voice provider by name. Adding one: write the adapter file, add one line here. */
export const VOICES: Readonly<Record<string, VoiceFactory>> = {
  azure: createAzureVoice,
  elevenlabs: createElevenLabsVoice,
  google: createGoogleVoice,
  local: createLocalVoice,
  openai: createOpenAIVoice,
  polly: createPollyVoice,
};

export function getVoiceProvider(name: string, ctx: ProviderContext): VoiceProvider {
  const factory = VOICES[name];
  if (factory === undefined) {
    throw new DispatchError('unknown-provider', `unknown voice provider "${name}". Choose one of: ${Object.keys(VOICES).sort().join(', ')}`);
  }
  return factory(ctx);
}
