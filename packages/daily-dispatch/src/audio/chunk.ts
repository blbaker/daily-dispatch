import { DispatchError } from '../errors.ts';
import type { Script, Turn } from '../types.ts';
import type { VoiceCapabilities } from '../voices/types.ts';

/** One provider request: consecutive turns from a single segment. */
export interface Chunk {
  index: number;
  /** Index of the segment this chunk belongs to. */
  segment: number;
  turns: Turn[];
  /** Characters sent, after tag filtering. */
  chars: number;
  /** The last chunk of its segment gets the longer pause after it. */
  lastInSegment: boolean;
}

const TAG = /\[([^\]]*)\]/g;

/** Drop audio tags the provider would read aloud as words. */
export function filterTags(text: string, supported: VoiceCapabilities['supportedTags']): string {
  if (supported === 'all') return text;
  const keep = new Set(supported.map((s) => s.toLowerCase()));
  return text
    .replace(TAG, (whole, inner: string) => (keep.has(inner.trim().toLowerCase()) ? whole : ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group turns into requests the way the production pipeline does: fill a
 * chunk on line boundaries up to `maxCharsPerRequest` (1,900 for
 * Text-to-Dialogue, which documents about 2,000 as the reliable ceiling),
 * never across a segment, and never past the provider's unique-voice limit.
 * Single-speaker providers get one turn per request.
 */
export function planChunks(script: Script, caps: VoiceCapabilities): Chunk[] {
  const chunks: Chunk[] = [];
  const max = caps.maxCharsPerRequest;
  const maxVoices = caps.multiSpeaker ? caps.maxVoicesPerRequest : 1;

  script.segments.forEach((seg, segment) => {
    let turns: Turn[] = [];
    let chars = 0;
    let voices = new Set<string>();
    const flush = (): void => {
      if (turns.length === 0) return;
      chunks.push({ index: chunks.length, segment, turns, chars, lastInSegment: false });
      turns = [];
      chars = 0;
      voices = new Set();
    };
    for (const raw of seg.turns) {
      const turn = { speaker: raw.speaker, text: filterTags(raw.text, caps.supportedTags) };
      if (turn.text.length > max) {
        throw new DispatchError(
          'turn-too-long',
          `a ${turn.speaker} turn in "${seg.title}" is ${turn.text.length} characters; this provider takes ${max} per request. Split the turn.`,
        );
      }
      const newVoice = !voices.has(turn.speaker);
      const full = chars + turn.text.length > max || (newVoice && voices.size >= maxVoices);
      if (!caps.multiSpeaker || full) flush();
      turns.push(turn);
      chars += turn.text.length;
      voices.add(turn.speaker);
    }
    flush();
    const last = chunks[chunks.length - 1];
    if (last !== undefined && last.segment === segment) last.lastInSegment = true;
  });
  return chunks;
}
