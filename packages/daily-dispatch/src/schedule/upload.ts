import fs from 'node:fs/promises';
import { DispatchError } from '../errors.ts';
import { backendPost } from './backend.ts';
import type { Backend } from './backend.ts';

export interface EpisodeUpload {
  /** The local date, YYYY-MM-DD. The backend uses it as the episode id. */
  date: string;
  title: string;
  file: string;
  durationSec?: number;
}

/** "Link Talk: Monday, October 19, 2026". The push notification shows it as the body. */
export function episodeTitle(show: string, date: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  // Noon UTC is the same calendar day in every zone, so the weekday cannot slip.
  return `${show}: ${fmt.format(new Date(`${date}T12:00:00Z`))}`.slice(0, 200);
}

interface Target {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function uploadTarget(reply: unknown): Target {
  const u = (reply as { upload?: Partial<Target> } | null)?.upload;
  if (typeof u?.url !== 'string' || !/^https?:\/\//.test(u.url)) {
    throw new DispatchError('bad-response', `backend: POST /episodes returned no upload URL: ${JSON.stringify(reply).slice(0, 120)}`);
  }
  return { url: u.url, method: typeof u.method === 'string' ? u.method : 'PUT', headers: { ...u.headers } };
}

/**
 * Publish one episode with the backend's two-step upload: POST the metadata
 * to get a presigned URL, PUT the audio there, then POST ready:true. The
 * backend checks the audio is in its bucket before it lists the episode and
 * sends the push, so the order matters. Returns the push report for the log.
 */
export async function uploadEpisode(b: Backend, ep: EpisodeUpload, fetchImpl: typeof fetch): Promise<string> {
  const audio = await fs.readFile(ep.file);
  const meta = { id: ep.date, date: ep.date, title: ep.title, contentType: 'audio/mpeg', ...(ep.durationSec !== undefined ? { durationSec: ep.durationSec } : {}) };
  const target = uploadTarget(await backendPost(b, '/episodes', meta, fetchImpl));
  const host = new URL(target.url).host;
  let res: Response;
  try {
    // Only the headers the backend listed: the API key must never reach the storage host.
    res = await fetchImpl(target.url, { method: target.method, headers: target.headers, body: audio });
  } catch (e) {
    throw new DispatchError('network', `could not upload the audio to ${host}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const excerpt = (await res.text().catch(() => '')).slice(0, 200);
    throw new DispatchError('http', `the audio upload to ${host} failed with HTTP ${res.status} ${excerpt}`.trim());
  }
  await res.body?.cancel();
  const done = await backendPost(b, '/episodes', { id: ep.date, ready: true }, fetchImpl);
  return JSON.stringify((done as { push?: unknown } | null)?.push ?? null).slice(0, 200);
}
