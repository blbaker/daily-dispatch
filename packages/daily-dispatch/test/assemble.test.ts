import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assembleEpisode } from '../src/audio/assemble.ts';
import { createFfmpeg } from '../src/audio/ffmpeg.ts';
import { isDispatchError } from '../src/errors.ts';
import { fakeSpawn } from './helpers.ts';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'dd-asm-'));
const parts = (dir: string) => [
  { path: path.join(dir, 'a.mp3'), lastInSegment: false },
  { path: path.join(dir, 'b.mp3'), lastInSegment: true },
  { path: path.join(dir, 'c.mp3'), lastInSegment: true },
];

test('assembly: silence, per-chunk wav, then one concat with loudness normalisation', async () => {
  const dir = await tmp();
  const s = fakeSpawn({});
  const ff = createFfmpeg({ env: {}, spawnImpl: s.spawn });
  const out = path.join(dir, 'episode.mp3');
  await assembleEpisode(parts(dir), out, path.join(dir, 'parts'), ff);

  assert.ok(s.calls.every((c) => c.command === 'ffmpeg'));
  assert.equal(s.calls.length, 2 + 3 + 1);
  const silence = s.calls.slice(0, 2).map((c) => c.args.join(' '));
  assert.match(silence[0] ?? '', /anullsrc=r=44100:cl=mono -t 0\.25 /);
  assert.match(silence[1] ?? '', /anullsrc=r=44100:cl=mono -t 0\.8 /);
  const convert = s.calls[2]?.args ?? [];
  assert.deepEqual(convert.slice(convert.indexOf('-i'), convert.indexOf('-i') + 6), ['-i', path.join(dir, 'a.mp3'), '-ac', '1', '-ar', '44100']);
  assert.equal(convert[convert.length - 1], path.join(dir, 'parts', '000.wav'));

  const final = s.calls[5]?.args ?? [];
  const list = final[final.indexOf('-i') + 1] ?? '';
  assert.ok(path.isAbsolute(list), 'concat list path is absolute');
  assert.deepEqual(final.slice(final.indexOf('-f'), final.indexOf('-f') + 4), ['-f', 'concat', '-safe', '0']);
  assert.ok(final.includes('loudnorm=I=-16:TP=-1.5:LRA=11'));
  assert.ok(final.includes('libmp3lame'));
  assert.equal(final[final.length - 1], out);

  const lines = (await fs.readFile(list, 'utf8')).trim().split('\n');
  const names = lines.map((l) => path.basename(l.replace(/^file '(.*)'$/, '$1')));
  assert.deepEqual(names, ['000.wav', 'gap.wav', '001.wav', 'seg.wav', '002.wav']);
  assert.ok(lines.every((l) => /^file '\//.test(l)), 'every entry is absolute');
});

test('assembly escapes single quotes in concat list paths', async () => {
  const dir = path.join(await tmp(), "it's here");
  const s = fakeSpawn({});
  await assembleEpisode(parts(dir).slice(0, 1), path.join(dir, 'e.mp3'), path.join(dir, 'parts'), createFfmpeg({ env: {}, spawnImpl: s.spawn }));
  const final = s.calls[s.calls.length - 1]?.args ?? [];
  const text = await fs.readFile(final[final.indexOf('-i') + 1] ?? '', 'utf8');
  assert.match(text, /it'\\''s here/);
});

test('ffmpeg missing is a clear, specific error', async () => {
  const s = fakeSpawn({ error: Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }) });
  const ff = createFfmpeg({ env: {}, spawnImpl: s.spawn });
  await assert.rejects(ff.check(), (e) => isDispatchError(e, 'ffmpeg-missing') && /ffmpeg was not found/.test(e.message) && /FFMPEG_PATH/.test(e.message));
});

test('FFMPEG_PATH overrides the binary, and a failing run reports stderr', async () => {
  const s = fakeSpawn({ code: 1, stderr: 'Invalid data found when processing input' });
  const ff = createFfmpeg({ env: { FFMPEG_PATH: '/opt/ff/ffmpeg' }, spawnImpl: s.spawn });
  await assert.rejects(ff.run(['-i', 'x']), (e) => isDispatchError(e, 'ffmpeg-failed') && /Invalid data/.test(e.message));
  assert.equal(s.calls[0]?.command, '/opt/ff/ffmpeg');
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('real ffmpeg: assembles two tones into one mp3 with the pauses between', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = await tmp();
  const ff = createFfmpeg({ env: {} });
  for (const [name, freq] of [['a', 440], ['b', 660]] as const) {
    await ff.run(['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=1`, '-c:a', 'libmp3lame', path.join(dir, `${name}.mp3`)]);
  }
  const out = path.join(dir, 'episode.mp3');
  await assembleEpisode(
    [
      { path: path.join(dir, 'a.mp3'), lastInSegment: true },
      { path: path.join(dir, 'b.mp3'), lastInSegment: true },
    ],
    out,
    path.join(dir, 'parts'),
    ff,
  );
  const seconds = await ff.duration(out);
  assert.ok(seconds > 2.6 && seconds < 3.1, `1s + 0.8s pause + 1s, got ${seconds}`);
});
