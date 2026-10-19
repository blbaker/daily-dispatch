import fs from 'node:fs/promises';
import { DispatchError } from '../errors.ts';
import { parseStories } from '../stories.ts';
import { backendFrom, backendGet } from './backend.ts';
import type { Env } from '../context.ts';
import type { Story } from '../types.ts';

export type StoriesResult = { stories: Story[] } | { waiting: string };

/**
 * The day's stories: a local digest file when a path is given ("{date}" is
 * replaced), otherwise the backend's /editions/<date>. A digest that is not
 * there yet, or an edition still being filled, is "waiting", not an error:
 * the next poll tries again.
 */
export async function loadDayStories(o: { date: string; file?: string; env: Env; fetchImpl: typeof fetch }): Promise<StoriesResult> {
  if (o.file !== undefined) {
    const file = o.file.replaceAll('{date}', o.date);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { waiting: `no stories for ${o.date} yet (${file} does not exist)` };
      throw e;
    }
    try {
      return { stories: parseStories(JSON.parse(text)) };
    } catch (e) {
      if (e instanceof DispatchError) throw e;
      throw new DispatchError('invalid-input', `stories file ${file} is not valid JSON: ${(e as Error).message}`);
    }
  }
  const backend = backendFrom(o.env);
  if (backend === undefined) {
    throw new DispatchError('invalid-input', 'no story source: set "stories" in the config file, or DAILY_DISPATCH_API_URL and DAILY_DISPATCH_API_KEY');
  }
  const edition = await backendGet(backend, `/editions/${o.date}`, o.fetchImpl);
  if (edition === null) return { waiting: `no edition for ${o.date} on the backend yet` };
  if (typeof edition === 'object' && (edition as { inProgress?: unknown }).inProgress === true) {
    return { waiting: `the ${o.date} edition is still in progress` };
  }
  return { stories: parseStories(edition) };
}
