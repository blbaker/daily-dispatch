import fs from 'node:fs/promises';
import path from 'node:path';
import { DispatchError } from '../errors.ts';
import type { DayRecord } from './clock.ts';

export interface StateFile {
  days: Record<string, DayRecord>;
}

/**
 * Which local dates already have an episode. A missing file is a fresh
 * start; a corrupt one is an error, because silently starting over would
 * pay for today's episode a second time.
 */
export async function readState(file: string): Promise<StateFile> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { days: {} };
    throw e;
  }
  try {
    const data = JSON.parse(text) as Partial<StateFile>;
    if (typeof data.days !== 'object' || data.days === null) throw new Error('no "days" object');
    return { days: data.days };
  } catch (e) {
    throw new DispatchError('invalid-input', `state file ${file} is damaged (${(e as Error).message}). Fix or move it; it records which dates already have an episode.`);
  }
}

/** Write to a temp file and rename, so a crash never leaves half a state file. */
export async function writeState(file: string, state: StateFile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await fs.rename(tmp, file);
}

/** A lock older than this belongs to a run that died; take it over. */
const STALE_MS = 3 * 60 * 60 * 1000;

/**
 * Cron starts a new run every interval even if the last one is still going
 * (systemd, launchd and Task Scheduler do not). The lock file keeps two runs
 * from voicing the same episode at once. Returns a release function, or
 * null when another run holds the lock.
 */
export async function acquireLock(file: string, now: Date): Promise<(() => Promise<void>) | null> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      const handle = await fs.open(file, 'wx');
      await handle.writeFile(`${process.pid} ${now.toISOString()}\n`);
      await handle.close();
      return async () => {
        await fs.unlink(file).catch(() => {});
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const age = now.getTime() - (await fs.stat(file)).mtimeMs;
      if (age < STALE_MS) return null;
      await fs.unlink(file).catch(() => {});
    }
  }
  return null;
}
