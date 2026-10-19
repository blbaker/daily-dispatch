import type { Prompt, WriterInfo } from './writers/types.ts';

export interface Estimate {
  writerUsd: number;
  voiceUsd: number;
  totalUsd: number;
}

/** English runs about four characters per token. */
const tokens = (chars: number): number => Math.ceil(chars / 4);

/** Rough cost of one script-writing call; 0 for free writers or when the script is given. */
export function writerCost(writer: WriterInfo, prompt: Prompt, outChars: number): number {
  if (!writer.paid || writer.price === undefined) return 0;
  const input = tokens(prompt.system.length + prompt.user.length);
  return (input * writer.price.inputPerMTok + tokens(outChars) * writer.price.outputPerMTok) / 1_000_000;
}

export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** About 16 to 17 characters per second of speech: characters / 1000 is roughly minutes. */
export const minutesFor = (chars: number): number => chars / 1000;
