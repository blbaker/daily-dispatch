import { DispatchError } from '../errors.ts';
import { createElevenLabsVoice } from './elevenlabs.ts';
import { createOpenAIVoice } from './openai.ts';
import type { ProviderContext } from '../context.ts';
import type { VoiceFactory, VoiceProvider } from './types.ts';

/** Every voice provider by name. Adding one: write the adapter file, add one line here. */
export const VOICES: Readonly<Record<string, VoiceFactory>> = {
  elevenlabs: createElevenLabsVoice,
  openai: createOpenAIVoice,
};

export function getVoiceProvider(name: string, ctx: ProviderContext): VoiceProvider {
  const factory = VOICES[name];
  if (factory === undefined) {
    throw new DispatchError('unknown-provider', `unknown voice provider "${name}". Choose one of: ${Object.keys(VOICES).sort().join(', ')}`);
  }
  return factory(ctx);
}
