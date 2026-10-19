import fs from 'node:fs/promises';
import path from 'node:path';
import { assembleEpisode } from './audio/assemble.ts';
import { synthesizeChunks } from './audio/cache.ts';
import { planChunks } from './audio/chunk.ts';
import { renderTranscript } from './audio/transcript.ts';
import { DispatchError } from './errors.ts';
import { formatUsd, minutesFor, writerCost } from './estimate.ts';
import { requireKey } from './http.ts';
import { buildPrompt } from './script/prompt.ts';
import { formatScript } from './script/parse.ts';
import { prepareStories } from './stories.ts';
import { placeholderVoices } from './voices-file.ts';
import { effectiveCapabilities } from './voices/types.ts';
import type { Ffmpeg } from './audio/ffmpeg.ts';
import type { Env } from './context.ts';
import type { Estimate } from './estimate.ts';
import type { Script, Story, VoiceMap } from './types.ts';
import type { VoiceProvider } from './voices/types.ts';
import type { ScriptWriter, WriteRequest } from './writers/types.ts';

export interface MakeOptions {
  stories: readonly Story[];
  voices: VoiceMap;
  writer: ScriptWriter;
  voice: VoiceProvider;
  outDir: string;
  /** No paid calls and no audio: write what can be written for free and print the estimate. */
  dryRun: boolean;
  ffmpeg: Ffmpeg;
  /** Used only to check that the providers' keys are set before anything is spent. */
  env: Env;
  log: (line: string) => void;
  title?: string;
  listener?: { name?: string; town?: string };
  /** Target episode length. Default 10. */
  minutes?: number;
  styleGuide?: string;
  /** Use this script instead of running the writer. */
  script?: Script;
  signal?: AbortSignal;
}

export interface MakeResult {
  dryRun: boolean;
  /** Undefined when a dry run skipped a paid writer. */
  script?: Script;
  chunks: number;
  /** Characters sent to the voice provider (an estimate when there is no script yet). */
  chars: number;
  estimate: Estimate;
  files: { prompt?: string; script?: string; transcript?: string; episode?: string };
  billedChars?: number;
}

/**
 * Stories in, episode out. Everything that can fail for a boring reason
 * (missing key, placeholder voice ids, no ffmpeg) is checked before the
 * first paid call, so a misconfigured run costs nothing.
 */
export async function makePodcast(o: MakeOptions): Promise<MakeResult> {
  const out = path.resolve(o.outDir);
  await fs.mkdir(out, { recursive: true });
  const files: MakeResult['files'] = {};
  const req: WriteRequest = {
    stories: prepareStories(o.stories),
    voices: o.voices,
    title: o.title ?? 'Link Talk',
    listener: o.listener ?? {},
    targetChars: Math.round((o.minutes ?? 10) * 1000),
    ...(o.styleGuide !== undefined ? { styleGuide: o.styleGuide } : {}),
  };
  const runWriter = o.script === undefined;

  if (!o.dryRun) {
    if (runWriter && o.writer.keyEnv) requireKey(o.env, o.writer.keyEnv, o.writer.name);
    if (o.voice.keyEnv) requireKey(o.env, o.voice.keyEnv, o.voice.name);
    const placeholders = placeholderVoices(o.voices);
    if (placeholders.length > 0) {
      throw new DispatchError('invalid-input', `voices file still has example placeholder ids for: ${placeholders.join(', ')}`);
    }
    await o.ffmpeg.check();
  }

  const prompt = buildPrompt(req);
  let script = o.script;
  if (runWriter && o.dryRun && o.writer.paid) {
    files.prompt = path.join(out, 'prompt.txt');
    await fs.writeFile(files.prompt, `${prompt.system}\n\n---\n\n${prompt.user}\n`);
    o.log(`dry run: ${o.writer.name} is a paid writer, so it was not called. The prompt it would get is in ${files.prompt}`);
  } else if (runWriter) {
    o.log(`writing the script with ${o.writer.name} (${req.stories.length} stories)...`);
    script = await o.writer.write(req, o.signal);
  }

  const caps = effectiveCapabilities(o.voice, o.voices);
  let chars = req.targetChars;
  let chunkCount = Math.ceil(chars / caps.maxCharsPerRequest);
  const chunks = script === undefined ? [] : planChunks(script, caps);
  if (script !== undefined) {
    chars = chunks.reduce((n, c) => n + c.chars, 0);
    chunkCount = chunks.length;
    files.script = path.join(out, 'script.txt');
    files.transcript = path.join(out, 'transcript.md');
    await fs.writeFile(files.script, formatScript(script));
    await fs.writeFile(files.transcript, renderTranscript(script, o.voices));
  }

  const writerUsd = runWriter ? writerCost(o.writer, prompt, chars) : 0;
  const voiceUsd = chars * caps.costPerChar;
  const estimate = { writerUsd, voiceUsd, totalUsd: writerUsd + voiceUsd };
  o.log(
    `segments=${script?.segments.length ?? '?'} chunks=${chunkCount} chars=${chars} est_minutes=${minutesFor(chars).toFixed(0)}` +
      (script === undefined ? ' (estimated from --minutes)' : ''),
  );
  o.log(`estimated cost: writer ${formatUsd(writerUsd)} + voice ${formatUsd(voiceUsd)} = ${formatUsd(estimate.totalUsd)}`);
  if (voiceUsd > 0) o.log(`  ${o.voice.name}: ${o.voice.costSource}`);
  if (o.writer.price && writerUsd > 0) o.log(`  ${o.writer.name}: ${o.writer.price.source}`);

  const base = { script, chunks: chunkCount, chars, estimate, files };
  if (o.dryRun || script === undefined) return { ...base, dryRun: true };

  await o.voice.preflight?.(chars);
  const audio = await synthesizeChunks(chunks, o.voice, o.voices, path.join(out, 'chunks'), {
    ...(o.signal ? { signal: o.signal } : {}),
  });
  let billedChars = 0;
  for (const a of audio) {
    billedChars += a.billedChars;
    const seconds = await o.ffmpeg.duration(a.path);
    const rate = seconds > 0 ? a.chunk.chars / seconds : 0;
    // Speech runs 7-22 characters per second. Outside that, the provider
    // probably dropped or repeated part of the chunk.
    const flag = rate < 7 || rate > 22 ? '  <-- CHECK' : '';
    o.log(`chunk ${String(a.chunk.index).padStart(2, '0')} ${a.status.padEnd(6)} chars=${a.chunk.chars} dur=${seconds.toFixed(1)}s chars/s=${rate.toFixed(1)}${flag}`);
  }
  files.episode = path.join(out, 'episode.mp3');
  await assembleEpisode(audio.map((a) => ({ path: a.path, lastInSegment: a.chunk.lastInSegment })), files.episode, path.join(out, 'parts'), o.ffmpeg);
  o.log(`OUT ${files.episode} (${((await o.ffmpeg.duration(files.episode)) / 60).toFixed(1)} min), billed characters=${billedChars}`);
  return { ...base, dryRun: false, billedChars };
}
