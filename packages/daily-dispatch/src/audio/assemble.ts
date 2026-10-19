import fs from 'node:fs/promises';
import path from 'node:path';
import type { Ffmpeg } from './ffmpeg.ts';

export interface EpisodePart {
  path: string;
  /** A longer pause follows the last chunk of a segment. */
  lastInSegment: boolean;
}

export interface AssembleOptions {
  /** Seconds of silence between chunks inside a segment. */
  gap?: number;
  /** Seconds of silence after a segment. */
  segmentGap?: number;
}

/** ffmpeg concat-list line; a single quote inside a quoted path is written as '\''. */
const listLine = (p: string): string => `file '${p.replace(/'/g, `'\\''`)}'\n`;

/**
 * Join chunk audio into one MP3 the way the production pipeline does: decode
 * every chunk to mono 44.1 kHz WAV, interleave short and long silences, then
 * one concat pass with loudness normalisation to -16 LUFS. The concat
 * demuxer resolves relative paths against the list file, so every entry is
 * absolute.
 */
export async function assembleEpisode(
  parts: readonly EpisodePart[],
  outFile: string,
  workDir: string,
  ff: Ffmpeg,
  opts: AssembleOptions = {},
): Promise<void> {
  const dir = path.resolve(workDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.dirname(path.resolve(outFile)), { recursive: true });

  const silence = { gap: path.join(dir, 'gap.wav'), seg: path.join(dir, 'seg.wav') };
  for (const [file, seconds] of [
    [silence.gap, opts.gap ?? 0.25],
    [silence.seg, opts.segmentGap ?? 0.8],
  ] as const) {
    await ff.run(['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(seconds), file]);
  }

  const entries: string[] = [];
  for (const [i, part] of parts.entries()) {
    const wav = path.join(dir, `${String(i).padStart(3, '0')}.wav`);
    await ff.run(['-y', '-v', 'error', '-i', path.resolve(part.path), '-ac', '1', '-ar', '44100', wav]);
    entries.push(wav, part.lastInSegment ? silence.seg : silence.gap);
  }
  entries.pop(); // no pause after the final chunk

  const list = path.join(dir, 'list.txt');
  await fs.writeFile(list, entries.map(listLine).join(''));
  await ff.run([
    '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-ar', '44100',
    '-c:a', 'libmp3lame', '-b:a', '96k', path.resolve(outFile),
  ]);
}
