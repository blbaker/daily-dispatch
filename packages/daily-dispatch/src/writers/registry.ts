import { DispatchError } from '../errors.ts';
import { createAnthropicWriter } from './anthropic.ts';
import { createCommandWriter } from './command.ts';
import { createOllamaWriter } from './ollama.ts';
import { createOpenAIWriter } from './openai.ts';
import type { ProviderContext } from '../context.ts';
import type { ScriptWriter, WriterFactory } from './types.ts';

/** Every script writer by name. Adding one: write the adapter file, add one line here. */
export const WRITERS: Readonly<Record<string, WriterFactory>> = {
  anthropic: createAnthropicWriter,
  command: createCommandWriter,
  ollama: createOllamaWriter,
  openai: createOpenAIWriter,
};

export function getWriter(name: string, ctx: ProviderContext): ScriptWriter {
  const factory = WRITERS[name];
  if (factory === undefined) {
    throw new DispatchError('unknown-provider', `unknown script writer "${name}". Choose one of: ${Object.keys(WRITERS).sort().join(', ')}`);
  }
  return factory(ctx);
}
