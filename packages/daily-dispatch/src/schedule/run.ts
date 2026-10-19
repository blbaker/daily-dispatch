import fs from 'node:fs/promises';
import path from 'node:path';
import { createFfmpeg } from '../audio/ffmpeg.ts';
import { DispatchError, isDispatchError } from '../errors.ts';
import { makePodcast } from '../podcast.ts';
import { parseScript } from '../script/parse.ts';
import { getVoiceProvider } from '../voices/registry.ts';
import { getWriter } from '../writers/registry.ts';
import { backendFrom } from './backend.ts';
import { decide, localTime } from './clock.ts';
import { resolveSettings } from './config.ts';
import { publishPending } from './publish.ts';
import { acquireLock, readState, writeState } from './state.ts';
import { loadDayStories } from './stories-source.ts';
import type { spawn } from 'node:child_process';
import type { Env } from '../context.ts';
import type { Script } from '../types.ts';
import type { LocalConfig } from './config.ts';

export interface RunOptions {
  /** Only run when the schedule says so (enabled, past the time, not done today). */
  ifDue: boolean;
  /** Ignore the state file: run even if the date is done or gave up. */
  force: boolean;
  dryRun: boolean;
  /** Allow paid providers (also "confirm": true in the config file). */
  confirm: boolean;
  /** YYYY-MM-DD to make instead of today (not with ifDue). */
  date?: string;
  config: LocalConfig;
  configPath: string;
  statePath: string;
  /** Episodes go in <outDir>/<date>/. */
  outDir: string;
  /** Local digest path; "{date}" is replaced. Without it, stories come from the backend. */
  storiesFile?: string;
  env: Env;
  fetchImpl: typeof fetch;
  spawnImpl?: typeof spawn;
  sleep: (ms: number) => Promise<void>;
  now: Date;
  log: (line: string) => void;
}

export type RunOutcome =
  | { status: 'not-due'; reason: string }
  | { status: 'waiting'; detail: string }
  | { status: 'busy' }
  | { status: 'dry-run'; date: string }
  | { status: 'done'; date: string; episode: string };

/** Failures that happen before anything is spent; they do not use up one of the day's attempts. */
const BEFORE_SPENDING = new Set(['usage', 'invalid-input', 'unknown-provider', 'no-key', 'ffmpeg-missing']);

async function previousScript(file: string, tags: string[], title: string, log: (l: string) => void): Promise<Script | undefined> {
  const text = await fs.readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const script = parseScript(text, tags, title);
    log(`reusing the script from an earlier attempt: ${file}`);
    return script;
  } catch {
    log(`ignoring ${file}: it no longer matches the voices`);
    return undefined;
  }
}

/**
 * Make the episode if it is due, then publish any episode still waiting for
 * its upload. Publishing is a separate pass so a failed upload is retried on
 * the next poll without making the episode again.
 */
export async function runPodcast(o: RunOptions): Promise<RunOutcome> {
  const outcome = await makeEpisode(o);
  await publishPending({ env: o.env, statePath: o.statePath, show: showTitle(o), dryRun: o.dryRun, fetchImpl: o.fetchImpl, now: o.now, log: o.log });
  return outcome;
}

const showTitle = (o: RunOptions): string => o.config.title ?? 'Link Talk';

async function makeEpisode(o: RunOptions): Promise<RunOutcome> {
  const s = await resolveSettings({ env: o.env, config: o.config, fetchImpl: o.fetchImpl, configPath: o.configPath });
  const state = await readState(o.statePath);
  const where = `daily podcast at ${s.time} ${s.timezone}, settings from the ${s.source}`;

  let date: string;
  if (o.ifDue) {
    const d = decide(s, o.now, (day) => (o.force ? undefined : state.days[day]));
    if (!d.due) {
      o.log(`not due: ${d.reason}${d.date ? ` (${d.date})` : ''}; ${where}`);
      return { status: 'not-due', reason: d.reason };
    }
    date = d.date;
  } else {
    if (o.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new DispatchError('usage', '--date must be YYYY-MM-DD');
    date = o.date ?? localTime(o.now, s.timezone).date;
    if (!o.force && state.days[date]?.status === 'done') {
      o.log(`not due: already-done (${date}); use --force to make it again`);
      return { status: 'not-due', reason: 'already-done' };
    }
  }

  const base = { env: o.env, fetchImpl: o.fetchImpl, sleep: o.sleep, ...(o.spawnImpl ? { spawnImpl: o.spawnImpl } : {}) };
  const writer = getWriter(s.writer, {
    ...base,
    ...(o.config.model !== undefined ? { model: o.config.model } : {}),
    ...(o.config.writerCommand !== undefined ? { command: o.config.writerCommand } : {}),
  });
  const voice = getVoiceProvider(s.voice, { ...base, ...(o.config.voiceModel !== undefined ? { model: o.config.voiceModel } : {}) });
  const paid = [writer, voice].filter((p) => p.paid).map((p) => p.name);
  if (paid.length > 0 && !o.dryRun && !o.confirm && o.config.confirm !== true) {
    throw new DispatchError(
      'usage',
      `${paid.join(' and ')} ${paid.length > 1 ? 'are paid providers' : 'is a paid provider'}. Scheduled runs only spend money when the config file has "confirm": true (or with --confirm).`,
    );
  }
  if (s.voices === undefined) {
    throw new DispatchError('invalid-input', 'no host voices: set them in the app\'s Settings screen, or "podcast.voices" in the config file');
  }

  const release = await acquireLock(`${o.statePath}.lock`, o.now);
  if (release === null) {
    o.log(`skipped: another run is in progress (${o.statePath}.lock)`);
    return { status: 'busy' };
  }
  try {
    const day = await loadDayStories({ date, env: o.env, fetchImpl: o.fetchImpl, ...(o.storiesFile !== undefined ? { file: o.storiesFile } : {}) });
    if ('waiting' in day) {
      o.log(`waiting: ${day.waiting}`);
      return { status: 'waiting', detail: day.waiting };
    }
    const outDir = path.join(o.outDir, date);
    const title = showTitle(o);
    const script = o.force ? undefined : await previousScript(path.join(outDir, 'script.txt'), Object.keys(s.voices), title, o.log);
    o.log(`making the ${date} episode with ${s.writer} and ${s.voice}`);
    try {
      const result = await makePodcast({
        stories: day.stories,
        voices: s.voices,
        writer,
        voice,
        outDir,
        dryRun: o.dryRun,
        ffmpeg: createFfmpeg({ env: o.env, ...(o.spawnImpl ? { spawnImpl: o.spawnImpl } : {}) }),
        env: o.env,
        log: o.log,
        title,
        listener: { name: o.config.listener?.name ?? o.env['LISTENER_NAME'] ?? '', town: o.config.listener?.town ?? o.env['LISTENER_TOWN'] ?? '' },
        minutes: o.config.minutes ?? 10,
        ...(script !== undefined ? { script } : {}),
      });
      if (result.dryRun || result.files.episode === undefined) return { status: 'dry-run', date };
      state.days[date] = {
        status: 'done',
        attempts: (state.days[date]?.attempts ?? 0) + 1,
        at: o.now.toISOString(),
        episode: result.files.episode,
        ...(result.durationSec !== undefined && result.durationSec > 0 ? { durationSec: Math.round(result.durationSec) } : {}),
        // Recorded before the upload starts, so a crash mid-upload still leaves it to retry.
        ...(backendFrom(o.env) !== undefined ? { upload: { status: 'pending', attempts: 0 } } : {}),
      };
      await writeState(o.statePath, state);
      o.log(`episode ready: ${result.files.episode}`);
      return { status: 'done', date, episode: result.files.episode };
    } catch (e) {
      if (!(isDispatchError(e) && BEFORE_SPENDING.has(e.kind))) {
        const attempts = (state.days[date]?.attempts ?? 0) + 1;
        state.days[date] = { status: 'failed', attempts, at: o.now.toISOString(), error: (e as Error).message.slice(0, 300) };
        await writeState(o.statePath, state);
      }
      throw e;
    }
  } finally {
    await release();
  }
}
