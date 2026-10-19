import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Chunk } from './chunk.ts';
import type { VoiceMap } from '../types.ts';
import type { VoiceProvider } from '../voices/types.ts';

export interface ChunkAudio {
  chunk: Chunk;
  /** Absolute path to the chunk's audio file. */
  path: string;
  status: 'new' | 'cached';
  billedChars: number;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Content hash of everything that changes a chunk's audio. Key order does not matter. */
export function chunkHash(provider: string, key: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stable({ provider, key })))
    .digest('hex')
    .slice(0, 16);
}

const exists = (p: string): Promise<boolean> =>
  fs.stat(p).then(
    (s) => s.size > 0,
    () => false,
  );

/**
 * Voice every chunk, reusing any chunk whose content hash already has audio
 * in `dir`. Files are named by hash alone, so fixing one line and rerunning
 * only pays for the chunk that changed, even when chunks before it moved.
 * Audio is written to a temp file and renamed, so an interrupted run never
 * leaves a truncated file that a later run would trust.
 */
export async function synthesizeChunks(
  chunks: readonly Chunk[],
  provider: VoiceProvider,
  voices: VoiceMap,
  dir: string,
  opts: { concurrency?: number; signal?: AbortSignal; onChunk?: (a: ChunkAudio) => void } = {},
): Promise<ChunkAudio[]> {
  const absDir = path.resolve(dir);
  await fs.mkdir(absDir, { recursive: true });
  const results: ChunkAudio[] = new Array<ChunkAudio>(chunks.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (let i = next++; i < chunks.length; i = next++) {
      const chunk = chunks[i]!;
      const req = { turns: chunk.turns, voices };
      const file = path.join(absDir, `${chunkHash(provider.name, provider.requestKey(req))}.mp3`);
      let result: ChunkAudio;
      if (await exists(file)) {
        result = { chunk, path: file, status: 'cached', billedChars: 0 };
      } else {
        const out = await provider.synthesize(req, opts.signal);
        const tmp = `${file}.tmp-${process.pid}-${i}`;
        await fs.writeFile(tmp, out.audio);
        await fs.rename(tmp, file);
        result = { chunk, path: file, status: 'new', billedChars: out.billedChars ?? 0 };
      }
      results[i] = result;
      opts.onChunk?.(result);
    }
  };

  const n = Math.max(1, Math.min(opts.concurrency ?? 3, chunks.length));
  // On the first failure, stop taking new chunks but let in-flight ones
  // finish, so the error is reported after every write has settled.
  const settled = await Promise.allSettled(
    Array.from({ length: n }, () =>
      worker().catch((e: unknown) => {
        next = chunks.length;
        throw e;
      }),
    ),
  );
  const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failure !== undefined) throw failure.reason;
  return results;
}
