import fs from 'node:fs/promises';
import path from 'node:path';
import { DispatchError } from '../errors.ts';
import { parseVoiceMap } from '../voices-file.ts';
import { API_KEY_ENV, API_URL_ENV, backendFrom, backendGet } from './backend.ts';
import { resolvePath } from './paths.ts';
import type { Env } from '../context.ts';
import type { VoiceMap } from '../types.ts';
import type { ScheduleWindow } from './clock.ts';

/** The daily schedule as the app's Settings screen and the config file both describe it. */
export interface PodcastSection {
  enabled?: boolean;
  time?: string;
  timezone?: string;
  writer?: string;
  voice?: string;
  /** voices.json path, a voice map, or host name -> voice id. */
  voices?: unknown;
}

/** ~/.config/daily-dispatch/config.json. Every field is optional. */
export interface LocalConfig {
  podcast?: PodcastSection;
  /** Episodes go in <out>/<date>/. */
  out?: string;
  /** Local digest file; "{date}" becomes YYYY-MM-DD. Without it, stories come from the backend. */
  stories?: string;
  minutes?: number;
  title?: string;
  model?: string;
  voiceModel?: string;
  writerCommand?: string;
  listener?: { name?: string; town?: string };
  /** Let scheduled runs use paid providers. Off by default. */
  confirm?: boolean;
  /** Directory of the config file, for relative paths. Set by loadConfig. */
  dir?: string;
}

export interface RunSettings extends ScheduleWindow {
  source: 'backend' | 'config';
  writer: string;
  voice: string;
  /** Undefined when neither the backend nor the config names any voices. */
  voices: VoiceMap | undefined;
}

/** The backend's defaults (backend/lambda/settings.ts), used for fields a config file leaves out. */
const DEFAULTS = { enabled: false, time: '06:00', timezone: 'UTC', writer: 'command', voice: 'elevenlabs' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function loadConfig(file: string, explicit: boolean): Promise<LocalConfig> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (!explicit && (e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new DispatchError('invalid-input', `cannot read config file ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new DispatchError('invalid-input', `config file ${file} is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObj(data)) throw new DispatchError('invalid-input', `config file ${file} must be a JSON object`);
  if (data['podcast'] !== undefined && !isObj(data['podcast'])) throw new DispatchError('invalid-input', `config file ${file}: "podcast" must be an object`);
  return { ...(data as LocalConfig), dir: path.dirname(path.resolve(file)) };
}

/** S1, S2, ... in the order the hosts are listed; the name is what the transcript shows. */
function hostMap(hosts: Record<string, string>): VoiceMap {
  return Object.fromEntries(Object.entries(hosts).map(([name, id], i) => [`S${i + 1}`, { id, name }]));
}

async function voicesFrom(raw: unknown, dir: string, env: Env): Promise<VoiceMap | undefined> {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    const file = resolvePath(raw, dir, env);
    const text = await fs.readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
      throw new DispatchError('invalid-input', `cannot read voices file ${file}: ${e.code ?? e.message}`);
    });
    try {
      return parseVoiceMap(JSON.parse(text));
    } catch (e) {
      if (e instanceof DispatchError) throw e;
      throw new DispatchError('invalid-input', `voices file ${file} is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (isObj(raw) && Object.values(raw).every((v) => typeof v === 'string')) {
    return Object.keys(raw).length === 0 ? undefined : hostMap(raw as Record<string, string>);
  }
  return parseVoiceMap(raw);
}

function field<T>(section: Record<string, unknown>, key: string, type: 'string' | 'boolean', fallback: T): T {
  const v = section[key];
  if (v === undefined) return fallback;
  if (typeof v !== type) throw new DispatchError('invalid-input', `podcast.${key} must be a ${type}`);
  return v as T;
}

/**
 * The schedule to run. When DAILY_DISPATCH_API_URL and DAILY_DISPATCH_API_KEY
 * are set, the backend's /settings (what the app's Settings screen saves)
 * decides enabled, time, timezone, writer, voice and host voices; the config
 * file then only adds local things such as where episodes go. Otherwise the
 * config file's "podcast" section decides.
 */
export async function resolveSettings(o: { env: Env; config: LocalConfig; fetchImpl: typeof fetch; configPath?: string }): Promise<RunSettings> {
  const dir = o.config.dir ?? process.cwd();
  const local = (o.config.podcast ?? {}) as Record<string, unknown>;
  const localVoices = await voicesFrom(local['voices'], dir, o.env);
  const backend = backendFrom(o.env);

  if (backend !== undefined) {
    const data = await backendGet(backend, '/settings', o.fetchImpl);
    const p = isObj(data) && isObj(data['podcast']) ? data['podcast'] : undefined;
    if (p === undefined) throw new DispatchError('bad-response', 'backend: /settings has no "podcast" section');
    const hosts = isObj(p['hostVoices']) ? await voicesFrom(p['hostVoices'], dir, o.env) : undefined;
    return {
      source: 'backend',
      enabled: field(p, 'enabled', 'boolean', DEFAULTS.enabled),
      time: field(p, 'time', 'string', DEFAULTS.time),
      timezone: field(p, 'timezone', 'string', DEFAULTS.timezone),
      writer: field(p, 'scriptWriter', 'string', DEFAULTS.writer),
      voice: field(p, 'voiceProvider', 'string', DEFAULTS.voice),
      voices: hosts ?? localVoices,
    };
  }

  if (o.config.podcast === undefined) {
    const where = o.configPath ?? 'the config file';
    throw new DispatchError(
      'invalid-input',
      `the daily podcast is not set up: add a "podcast" section to ${where}, or set ${API_URL_ENV} and ${API_KEY_ENV} to use the app's settings`,
    );
  }
  return {
    source: 'config',
    enabled: field(local, 'enabled', 'boolean', DEFAULTS.enabled),
    time: field(local, 'time', 'string', DEFAULTS.time),
    timezone: field(local, 'timezone', 'string', DEFAULTS.timezone),
    writer: field(local, 'writer', 'string', DEFAULTS.writer),
    voice: field(local, 'voice', 'string', DEFAULTS.voice),
    voices: localVoices,
  };
}

/** KEY=VALUE lines; "#" comments, blank lines and an "export " prefix are allowed. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m === null) continue;
    const raw = m[2]!;
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    out[m[1]!] = quoted ? quoted[2]! : raw;
  }
  return out;
}

/** The env file's values under the real environment: a variable set in the shell wins. */
export async function withEnvFile(env: Env, file: string): Promise<Env> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  return { ...parseEnvFile(text), ...env };
}
