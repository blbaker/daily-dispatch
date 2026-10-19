/**
 * Hand-run mutation check: break one rule at a time in the source, run the
 * test file that guards it, and confirm the named test fails. A mutant that
 * survives means that test cannot fail and needs strengthening.
 *
 *   node scripts/mutate.ts            # every mutant
 *   node scripts/mutate.ts M3 M7      # just these
 *
 * The source file is always restored, even when the test run crashes.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface Mutant {
  id: string;
  file: string;
  from: string;
  to: string;
  test: string;
  /** The failing test's name must match this. */
  expect: RegExp;
}

const MUTANTS: Mutant[] = [
  { id: 'M1', file: 'src/script/parse.ts', from: "if (stripTags(words) === '') {", to: "if (false && stripTags(words) === '') {", test: 'test/parse.test.ts', expect: /rejects a turn that is only audio tags/ },
  { id: 'M2', file: 'src/script/parse.ts', from: 'if (!known.has(speaker)) {', to: 'if (false) {', test: 'test/parse.test.ts', expect: /rejects a speaker that is not in the voice map/ },
  { id: 'M3', file: 'src/script/parse.ts', from: 'if (second !== undefined) {', to: 'if (false) {', test: 'test/parse.test.ts', expect: /two speakers on one line/ },
  { id: 'M4', file: 'src/audio/chunk.ts', from: 'chars + turn.text.length > max', to: 'chars + turn.text.length >= max', test: 'test/chunk.test.ts', expect: /may fill maxChars exactly/ },
  { id: 'M5', file: 'src/audio/chunk.ts', from: 'if (!caps.multiSpeaker || full) flush();', to: 'if (full) flush();', test: 'test/chunk.test.ts', expect: /single-speaker providers get one turn per request/ },
  { id: 'M6', file: 'src/audio/chunk.ts', from: 'last.segment === segment) last.lastInSegment = true;', to: 'last.segment === segment) last.lastInSegment = false;', test: 'test/chunk.test.ts', expect: /never puts two segments in one chunk/ },
  { id: 'M7', file: 'src/http.ts', from: 'if (RETRY.has(res.status) && !last) {', to: 'if (false && RETRY.has(res.status) && !last) {', test: 'test/http.test.ts', expect: /retries 409 already_running/ },
  { id: 'M8', file: 'src/audio/cache.ts', from: 'if (await exists(file)) {', to: 'if (false) {', test: 'test/cache.test.ts', expect: /serves a rerun entirely from the cache/ },
  { id: 'M9', file: 'src/voices/elevenlabs.ts', from: 'v.settings !== undefined || v.model !== undefined', to: 'false', test: 'test/voices.test.ts', expect: /switches to per-turn text-to-speech/ },
  { id: 'M10', file: 'src/audio/assemble.ts', from: 'entries.pop(); // no pause after the final chunk', to: '// mutant: keep the trailing pause', test: 'test/assemble.test.ts', expect: /silence, per-chunk wav, then one concat/ },
  { id: 'M11', file: 'src/writers/command.ts', from: 'child.stdin?.end(`${prompt.system}\\n\\n${prompt.user}\\n`);', to: 'child.stdin?.end(prompt.user);', test: 'test/writers.test.ts', expect: /prompt on stdin/ },
  { id: 'M12', file: 'src/writers/anthropic.ts', from: "const key = requireKey(ctx.env, KEY, 'anthropic');", to: "const key = ctx.env[KEY] ?? '';", test: 'test/writers.test.ts', expect: /anthropic: no key means no request/ },
  { id: 'M13', file: 'src/podcast.ts', from: 'if (runWriter && o.dryRun && o.writer.paid) {', to: 'if (runWriter && o.dryRun && !o.writer.paid) {', test: 'test/podcast.test.ts', expect: /dry run with paid providers touches no network/ },
  { id: 'M14', file: 'src/cli/podcast-make.ts', from: "(paid.length > 0 && flags.confirm !== true)", to: "(false && flags.confirm !== true)", test: 'test/cli.test.ts', expect: /paid providers default to a dry run/ },
  { id: 'M15', file: 'src/podcast.ts', from: 'await o.ffmpeg.check();', to: '', test: 'test/podcast.test.ts', expect: /missing ffmpeg stops a real run/ },
  // Toward false positives: flag any upper-case word before a colon, not just known speakers.
  { id: 'M16', file: 'src/script/parse.ts', from: 'const second = speakers.find(', to: 'const second = /\\b[A-Z0-9_]+(?=:)/.exec(words)?.[0] ?? speakers.find(', test: 'test/parse.test.ts', expect: /a colon after an ordinary word is still fine/ },
];

const root = path.resolve(import.meta.dirname, '..');

function runTests(file: string): string {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', file], { cwd: root, encoding: 'utf8' });
  return `${r.stdout}${r.stderr}`;
}

const failures = (out: string): string[] => out.split('\n').filter((l) => /^\s*✖ /.test(l)).map((l) => l.trim());

const only = new Set(process.argv.slice(2));
const chosen = MUTANTS.filter((m) => only.size === 0 || only.has(m.id));
let killed = 0;
let bad = 0;

// The detector must see a clean baseline first, or every verdict below is meaningless.
for (const test of new Set(chosen.map((m) => m.test))) {
  const base = failures(runTests(test));
  if (base.length > 0) {
    console.error(`BASELINE RED in ${test}; fix that before mutating:\n  ${base.join('\n  ')}`);
    process.exit(2);
  }
}

for (const m of chosen) {
  const file = path.join(root, m.file);
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(m.from).length - 1;
  if (count !== 1) {
    console.log(`ANCHOR-${count === 0 ? 'MISS' : 'AMBIGUOUS'}  ${m.id} ${m.file}: ${m.from}`);
    bad += 1;
    continue;
  }
  let out = '';
  try {
    fs.writeFileSync(file, original.replace(m.from, m.to));
    out = runTests(m.test);
  } finally {
    fs.writeFileSync(file, original);
  }
  const hit = failures(out).filter((l) => m.expect.test(l));
  if (hit.length > 0) {
    killed += 1;
    console.log(`KILLED       ${m.id} ${m.file} -> ${hit[0]}`);
  } else {
    bad += 1;
    console.log(`SURVIVED !! ${m.id} ${m.file} (wanted a failure matching ${m.expect})`);
    for (const l of failures(out).slice(0, 3)) console.log(`    saw: ${l}`);
  }
}

console.log(`\nkilled=${killed} not-killed=${bad} of ${chosen.length}${only.size > 0 ? ' (partial run)' : ''}`);
process.exit(bad === 0 ? 0 : 1);
