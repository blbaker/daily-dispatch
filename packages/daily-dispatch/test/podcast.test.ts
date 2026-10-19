import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makePodcast } from '../src/podcast.ts';
import type { MakeOptions } from '../src/podcast.ts';
import { textWriter } from '../src/writers/types.ts';
import { createAnthropicWriter } from '../src/writers/anthropic.ts';
import { createElevenLabsVoice } from '../src/voices/elevenlabs.ts';
import { isDispatchError } from '../src/errors.ts';
import { REQ, forbiddenFetch, instantSleep } from './helpers.ts';
import type { Ffmpeg } from '../src/audio/ffmpeg.ts';
import type { VoiceProvider } from '../src/voices/types.ts';

const SCRIPT = '## Open\nS1: Hello there, and welcome.\nS2: [laughs] Hi, my brother.\n\n## Close\nS1: That is the show.';
const KEYS = { ELEVENLABS_API_KEY: 'xi', ANTHROPIC_API_KEY: 'sk' };

function recorder() {
  const events: string[] = [];
  const ffmpeg: Ffmpeg & { missing?: boolean } = {
    async check() {
      events.push('ffmpeg.check');
      if (ffmpeg.missing) {
        const { DispatchError } = await import('../src/errors.ts');
        throw new DispatchError('ffmpeg-missing', 'ffmpeg was not found');
      }
    },
    async run(args) {
      events.push(`ffmpeg ${args.includes('concat') ? 'concat' : 'step'}`);
      const out = args[args.length - 1] ?? '';
      if (args.includes('concat')) await fs.writeFile(out, 'mp3');
    },
    async duration() {
      return 2;
    },
  };
  const voice: VoiceProvider = {
    name: 'fakevoice',
    paid: true,
    keyEnv: 'ELEVENLABS_API_KEY',
    capabilities: { multiSpeaker: true, maxCharsPerRequest: 1900, maxVoicesPerRequest: 10, supportedTags: 'all', costPerChar: 0.0001 },
    costSource: 'test',
    requestKey: (r) => r.turns,
    async preflight(chars) {
      events.push(`preflight ${chars}`);
    },
    async synthesize(req) {
      events.push(`synthesize ${req.turns.length}`);
      return { audio: new Uint8Array([1, 2, 3]), billedChars: 10 };
    },
  };
  const writer = textWriter({ name: 'fakewriter', paid: false }, async () => {
    events.push('write');
    return SCRIPT;
  });
  return { events, ffmpeg, voice, writer };
}

async function opts(over: Partial<MakeOptions>): Promise<MakeOptions> {
  const r = recorder();
  return {
    stories: REQ.stories.slice(),
    voices: REQ.voices,
    writer: r.writer,
    voice: r.voice,
    outDir: await fs.mkdtemp(path.join(os.tmpdir(), 'dd-pod-')),
    dryRun: false,
    ffmpeg: r.ffmpeg,
    env: KEYS,
    log: () => {},
    ...over,
  };
}

test('dry run with paid providers touches no network and no ffmpeg, and still estimates', async () => {
  const f = forbiddenFetch();
  const ctx = { env: KEYS, fetchImpl: f.fetch, sleep: instantSleep };
  const r = recorder();
  const o = await opts({ writer: createAnthropicWriter(ctx), voice: createElevenLabsVoice(ctx), ffmpeg: r.ffmpeg, dryRun: true, minutes: 12 });
  const res = await makePodcast(o);
  assert.equal(f.state.called, 0, 'fetch was called during a dry run');
  assert.deepEqual(r.events, []);
  assert.equal(res.script, undefined, 'the paid writer did not run');
  assert.equal(res.chars, 12000);
  assert.ok(res.estimate.writerUsd > 0 && res.estimate.voiceUsd > 0);
  assert.equal(res.estimate.voiceUsd, 12000 * 0.00008);
  assert.match(await fs.readFile(path.join(o.outDir, 'prompt.txt'), 'utf8'), /Every fact must come from the stories/);
});

test('dry run with a free writer writes the script and transcript and prices the real characters', async () => {
  const r = recorder();
  const o = await opts({ writer: r.writer, voice: r.voice, ffmpeg: r.ffmpeg, dryRun: true });
  const res = await makePodcast(o);
  assert.deepEqual(r.events, ['write']);
  const chars = 'Hello there, and welcome.'.length + '[laughs] Hi, my brother.'.length + 'That is the show.'.length;
  assert.equal(res.chars, chars);
  assert.equal(res.chunks, 2);
  assert.equal(res.estimate.voiceUsd, chars * 0.0001);
  assert.equal(res.estimate.writerUsd, 0);
  assert.match(await fs.readFile(path.join(o.outDir, 'script.txt'), 'utf8'), /^## Open\nS1: Hello there/);
  assert.match(await fs.readFile(path.join(o.outDir, 'transcript.md'), 'utf8'), /\*\*Host 2:\*\* Hi, my brother\./);
});

test('a full run checks, writes, checks the budget, voices, then assembles', async () => {
  const r = recorder();
  const o = await opts({ writer: r.writer, voice: r.voice, ffmpeg: r.ffmpeg });
  const res = await makePodcast(o);
  assert.deepEqual(r.events.slice(0, 4), ['ffmpeg.check', 'write', `preflight ${res.chars}`, 'synthesize 2']);
  assert.equal(r.events.filter((e) => e.startsWith('synthesize')).length, 2);
  assert.equal(r.events[r.events.length - 1], 'ffmpeg concat');
  assert.equal(res.files.episode, path.join(o.outDir, 'episode.mp3'));
  assert.equal(res.billedChars, 20);
});

test('a given script skips the writer entirely', async () => {
  const r = recorder();
  const script = { title: 'Mine', segments: [{ title: 'Only', turns: [{ speaker: 'S1', text: 'Just me.' }] }] };
  const res = await makePodcast(await opts({ writer: r.writer, voice: r.voice, ffmpeg: r.ffmpeg, script, dryRun: true }));
  assert.deepEqual(r.events, []);
  assert.equal(res.chars, 'Just me.'.length);
});

test('a missing key stops the run before anything is spent', async () => {
  const r = recorder();
  await assert.rejects(
    makePodcast(await opts({ writer: r.writer, voice: r.voice, ffmpeg: r.ffmpeg, env: {} })),
    (e) => isDispatchError(e, 'no-key') && /ELEVENLABS_API_KEY/.test(e.message),
  );
  assert.deepEqual(r.events, []);
});

test('placeholder voice ids stop a real run before anything is spent', async () => {
  const r = recorder();
  const voices = { ...REQ.voices, S1: { id: 'REPLACE_WITH_YOUR_ELEVENLABS_VOICE_ID', name: 'Host 1' } };
  await assert.rejects(
    makePodcast(await opts({ writer: r.writer, voice: r.voice, ffmpeg: r.ffmpeg, voices })),
    (e) => isDispatchError(e, 'invalid-input') && /S1/.test(e.message),
  );
  assert.deepEqual(r.events, []);
});

test('missing ffmpeg stops a real run before the writer runs', async () => {
  const r = recorder();
  r.ffmpeg.missing = true;
  await assert.rejects(makePodcast(await opts({ writer: r.writer, voice: r.voice, ffmpeg: r.ffmpeg })), (e) => isDispatchError(e, 'ffmpeg-missing'));
  assert.deepEqual(r.events, ['ffmpeg.check']);
});
