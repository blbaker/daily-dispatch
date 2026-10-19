import fs from 'node:fs/promises';
import { DispatchError } from '../errors.ts';
import { backendFrom } from './backend.ts';
import { acquireLock, readState, writeState } from './state.ts';
import { episodeTitle, uploadEpisode } from './upload.ts';
import type { Env } from '../context.ts';
import type { StateFile } from './state.ts';

export interface PublishOptions {
  env: Env;
  statePath: string;
  /** Show title; the episode title adds the date. */
  show: string;
  /** Report pending uploads without sending them. */
  dryRun: boolean;
  fetchImpl: typeof fetch;
  now: Date;
  log: (line: string) => void;
}

const pendingDates = (s: StateFile): string[] =>
  Object.keys(s.days)
    .filter((d) => s.days[d]?.upload?.status === 'pending')
    .sort();

/**
 * A GitHub Actions runner keeps only the state file between runs, so a retry
 * there finds no audio. Retrying that every poll would fail forever.
 */
async function missing(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/**
 * Upload every episode the state file marks as pending. It runs after every
 * poll, so an upload that failed is retried without making the episode again.
 */
export async function publishPending(o: PublishOptions): Promise<void> {
  const backend = backendFrom(o.env);
  if (backend === undefined) return;
  const waiting = pendingDates(await readState(o.statePath));
  if (waiting.length === 0) return;
  if (o.dryRun) {
    o.log(`dry run: the ${waiting.join(', ')} upload is still pending; a run without --dry-run sends it`);
    return;
  }
  const release = await acquireLock(`${o.statePath}.lock`, o.now);
  if (release === null) {
    o.log('upload skipped: another run is in progress');
    return;
  }
  try {
    // Read again under the lock: another run may have uploaded meanwhile.
    const state = await readState(o.statePath);
    const failed: string[] = [];
    for (const date of pendingDates(state)) {
      const day = state.days[date];
      if (day?.upload === undefined || day.episode === undefined) continue;
      const attempts = day.upload.attempts + 1;
      const at = o.now.toISOString();
      try {
        if (await missing(day.episode)) {
          day.upload = { status: 'gave-up', attempts, at, error: `${day.episode} no longer exists` };
          failed.push(`the ${date} episode cannot be uploaded: ${day.episode} no longer exists. Make it again with "daily-dispatch podcast run --force --date ${date}"`);
        } else {
          const push = await uploadEpisode(backend, { date, title: episodeTitle(o.show, date), file: day.episode, ...(day.durationSec !== undefined ? { durationSec: day.durationSec } : {}) }, o.fetchImpl);
          day.upload = { status: 'done', attempts, at };
          o.log(`uploaded the ${date} episode; push: ${push}`);
        }
      } catch (e) {
        const error = (e as Error).message.slice(0, 300);
        day.upload = { status: 'pending', attempts, at, error };
        failed.push(`the ${date} episode was made, but uploading it failed (${error}); the next run tries the upload again, without making the episode again`);
      }
      await writeState(o.statePath, state);
    }
    const [first, ...rest] = failed;
    if (first !== undefined) throw new DispatchError('upload-failed', first, rest);
  } finally {
    await release();
  }
}
