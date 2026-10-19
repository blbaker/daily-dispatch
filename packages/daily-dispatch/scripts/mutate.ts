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
  { id: 'M17', file: 'src/voices/google.ts', from: "speakers.length > 2", to: "speakers.length > 3", test: 'test/voices-google.test.ts', expect: /three speakers in one request is refused/ },
  { id: 'M18', file: 'src/voices/google.ts', from: "/^voice(key)?_/.test(v.id)", to: "false", test: 'test/voices-google.test.ts', expect: /custom voices go one turn at a time/ },
  { id: 'M19', file: 'src/voices/google.ts', from: "const multi = speakers.length === 2;", to: "const multi = speakers.length >= 1;", test: 'test/voices-google.test.ts', expect: /one speaker uses the single-voice form/ },
  { id: 'M20', file: 'src/voices/sigv4.ts', from: "day), opts.region), opts.service)", to: "day), opts.service), opts.region)", test: 'test/voices-polly.test.ts', expect: /get-vanilla/ },
  { id: 'M21', file: 'src/voices/sigv4.ts', from: "if (creds.sessionToken) headers['x-amz-security-token'] = creds.sessionToken;", to: "", test: 'test/voices-polly.test.ts', expect: /sign the session token/ },
  { id: 'M22', file: 'src/voices/polly.ts', from: "if (!REGION.test(r))", to: "if (false)", test: 'test/voices-polly.test.ts', expect: /secret or region is caught by checkConfig/ },
  { id: 'M23', file: 'src/voices/polly.ts', from: "costPerChar: price / 1_000_000,", to: "costPerChar: 16 / 1_000_000,", test: 'test/voices-polly.test.ts', expect: /the engine sets both the request and the price/ },
  { id: 'M24', file: 'src/voices/azure.ts', from: ">${esc(t.text)}</voice>", to: ">${t.text}</voice>", test: 'test/voices-azure.test.ts', expect: /XML-escaped/ },
  { id: 'M25', file: 'src/voices/azure.ts', from: "maxTurnsPerRequest: 50,", to: "", test: 'test/voices-azure.test.ts', expect: /at most 50 voice elements/ },
  { id: 'M26', file: 'src/audio/chunk.ts', from: " || turns.length >= (caps.maxTurnsPerRequest ?? Infinity)", to: "", test: 'test/chunk.test.ts', expect: /a provider turn limit starts a new chunk/ },
  { id: 'M27', file: 'src/podcast.ts', from: "o.voice.checkConfig?.();", to: "", test: 'test/podcast.test.ts', expect: /config check \(region, secret\) runs before the writer/ },
  { id: 'M28', file: 'src/voices/local.ts', from: "const key = ctx.env['LOCAL_TTS_API_KEY']?.trim();", to: "const key = 'leaked';", test: 'test/voices-local.test.ts', expect: /default Kokoro address/ },
  { id: 'M29', file: 'src/schedule/clock.ts', from: "if (local.minutes < target)", to: "if (local.minutes <= target)", test: 'test/schedule-clock.test.ts', expect: /at and after the time it is due/ },
  { id: 'M30', file: 'src/schedule/clock.ts', from: "'en-US', {\n      timeZone,", to: "'en-US', {\n      timeZone: 'UTC',", test: 'test/schedule-clock.test.ts', expect: /timezone edge: the local date/ },
  { id: 'M31', file: 'src/schedule/clock.ts', from: "day.attempts >= MAX_ATTEMPTS", to: "day.attempts > MAX_ATTEMPTS", test: 'test/schedule-clock.test.ts', expect: /three failed attempts on a date stop retries/ },
  { id: 'M32', file: 'src/schedule/clock.ts', from: "    throw new DispatchError('invalid-input', `podcast timezone \"${timeZone}\" is not an IANA time zone such as America/Chicago`);", to: "    return localTime(now, 'UTC');", test: 'test/schedule-clock.test.ts', expect: /unknown timezone or a malformed time is refused/ },
  { id: 'M33', file: 'src/schedule/clock.ts', from: "if (!s.enabled) return { due: false, reason: 'disabled' };", to: "", test: 'test/schedule-clock.test.ts', expect: /a disabled schedule never runs/ },
  { id: 'M34', file: 'src/schedule/run.ts', from: "if (!(isDispatchError(e) && BEFORE_SPENDING.has(e.kind))) {", to: "if (true) {", test: 'test/podcast-run.test.ts', expect: /missing key fails before spending and does not use up an attempt/ },
  { id: 'M35', file: 'src/schedule/run.ts', from: "o.force ? undefined : await previousScript(", to: "true ? undefined : await previousScript(", test: 'test/podcast-run.test.ts', expect: /a retry reuses the script/ },
  { id: 'M36', file: 'src/schedule/run.ts', from: "    date = d.date;", to: "    date = o.now.toISOString().slice(0, 10);", test: 'test/podcast-run.test.ts', expect: /the episode date is the local date/ },
  { id: 'M37', file: 'src/schedule/stories-source.ts', from: "(edition as { inProgress?: unknown }).inProgress === true", to: "false", test: 'test/podcast-run.test.ts', expect: /still in progress, or missing, means wait/ },
  { id: 'M38', file: 'src/schedule/state.ts', from: "if (age < STALE_MS) return null;", to: "if (false) return null;", test: 'test/podcast-run.test.ts', expect: /a run already in progress/ },
  { id: 'M39', file: 'src/schedule/config.ts', from: "if (backend !== undefined) {", to: "if (false) {", test: 'test/schedule-config.test.ts', expect: /settings come from the backend/ },
  { id: 'M40', file: 'src/schedule/config.ts', from: "return { ...parseEnvFile(text), ...env };", to: "return { ...env, ...parseEnvFile(text) };", test: 'test/schedule-config.test.ts', expect: /a variable set in the shell wins/ },
  { id: 'M41', file: 'src/schedule/jobs.ts', from: ".replace(/%/g, '%%').replace(/\\$/g, '$$$$')}\"`;", to: ".replace(/\\$/g, '$$$$')}\"`;", test: 'test/schedule-jobs.test.ts', expect: /% is escaped, because systemd expands/ },
  { id: 'M42', file: 'src/schedule/jobs.ts', from: "`'${s.replace(/'/g, `'\\\\''`)}'`.replace(/%/g, '\\\\%');", to: "`'${s.replace(/'/g, `'\\\\''`)}'`;", test: 'test/schedule-jobs.test.ts', expect: /cron: one marked block, shell-quoted/ },
  { id: 'M43', file: 'src/schedule/jobs.ts', from: "const kept = start === -1 || end === -1 ? lines : [...lines.slice(0, start), ...lines.slice(end + 1)];", to: "const kept = lines;", test: 'test/schedule-jobs.test.ts', expect: /replaces our block and leaves every other line alone/ },
  { id: 'M44', file: 'src/cli/schedule.ts', from: "  if (flags.print) {", to: "  if (false) {", test: 'test/schedule-cli.test.ts', expect: /--print shows every file and command and changes nothing/ },
  { id: 'M45', file: 'src/schedule/install.ts', from: "return (await io.exists('/run/systemd/system')) ? 'systemd' : 'cron';", to: "return 'cron';", test: 'test/schedule-cli.test.ts', expect: /detectKind/ },
  { id: 'M46', file: 'src/schedule/install.ts', from: "Buffer.from([0xff, 0xfe])", to: "Buffer.from([])", test: 'test/schedule-cli.test.ts', expect: /UTF-16 task XML/ },
  { id: 'M47', file: 'src/schedule/upload.ts', from: "headers: target.headers, body: audio", to: "headers: { ...target.headers, 'x-api-key': b.key }, body: audio", test: 'test/episode-upload.test.ts', expect: /a new episode is posted, PUT to the presigned URL/ },
  { id: 'M48', file: 'src/schedule/run.ts', from: "...(backendFrom(o.env) !== undefined ? { upload: { status: 'pending', attempts: 0 } } : {}),", to: "", test: 'test/episode-upload.test.ts', expect: /a new episode is posted, PUT to the presigned URL/ },
  { id: 'M49', file: 'src/schedule/run.ts', from: "backendFrom(o.env) !== undefined ? { upload:", to: "true ? { upload:", test: 'test/episode-upload.test.ts', expect: /nothing is uploaded/ },
  { id: 'M50', file: 'src/schedule/publish.ts', from: "day.upload = { status: 'pending', attempts, at, error };", to: "day.upload = { status: 'done', attempts, at, error };", test: 'test/episode-upload.test.ts', expect: /a failed PUT exits 1/ },
  { id: 'M51', file: 'src/schedule/publish.ts', from: "s.days[d]?.upload?.status === 'pending'", to: "s.days[d]?.upload !== undefined", test: 'test/episode-upload.test.ts', expect: /later runs and a manual run upload nothing/ },
  { id: 'M52', file: 'src/schedule/publish.ts', from: "s.days[d]?.upload?.status === 'pending'", to: "s.days[d]?.upload?.status !== 'done'", test: 'test/episode-upload.test.ts', expect: /file that is gone gives up once/ },
  { id: 'M53', file: 'src/schedule/publish.ts', from: "if (await missing(day.episode)) {", to: "if (false) {", test: 'test/episode-upload.test.ts', expect: /file that is gone gives up once/ },
  { id: 'M54', file: 'src/schedule/upload.ts', from: "if (!res.ok) {", to: "if (false) {", test: 'test/episode-upload.test.ts', expect: /a failed PUT exits 1/ },
  { id: 'M55', file: 'src/schedule/publish.ts', from: "if (o.dryRun) {", to: "if (false) {", test: 'test/episode-upload.test.ts', expect: /a dry run, or a run while another holds the lock/ },
  { id: 'M56', file: 'src/schedule/publish.ts', from: "if (release === null) {", to: "if (false) {", test: 'test/episode-upload.test.ts', expect: /a dry run, or a run while another holds the lock/ },
  { id: 'M57', file: 'src/schedule/upload.ts', from: "if (typeof u?.url !== 'string' || !/^https?:\\/\\//.test(u.url)) {", to: "if (false) {", test: 'test/episode-upload.test.ts', expect: /a backend refusal is explained/ },
  { id: 'M58', file: 'src/schedule/run.ts', from: "{ durationSec: Math.round(result.durationSec) }", to: "{}", test: 'test/episode-upload.test.ts', expect: /a new episode is posted, PUT to the presigned URL/ },
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
    // A function replacement inserts `to` literally; a string would expand $$ and $&.
    fs.writeFileSync(file, original.replace(m.from, () => m.to));
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
