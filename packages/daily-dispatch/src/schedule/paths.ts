import os from 'node:os';
import path from 'node:path';
import type { Env } from '../context.ts';

export interface DefaultPaths {
  /** ~/.config/daily-dispatch/config.json */
  config: string;
  /** ~/.config/daily-dispatch/env: KEY=VALUE lines the scheduled run loads. */
  envFile: string;
  /** ~/.local/state/daily-dispatch/state.json: which dates already have an episode. */
  state: string;
  /** ~/.local/share/daily-dispatch/episodes: one folder per date. */
  out: string;
}

export function homeDir(env: Env): string {
  return env['HOME']?.trim() || env['USERPROFILE']?.trim() || os.homedir();
}

/**
 * Where the scheduled run keeps things. The same XDG layout on every OS, so
 * the docs can name one path; each one can be overridden by a flag.
 */
export function defaultPaths(env: Env): DefaultPaths {
  const home = homeDir(env);
  const base = (xdg: string, ...fallback: string[]): string => path.join(env[xdg]?.trim() || path.join(home, ...fallback), 'daily-dispatch');
  const config = base('XDG_CONFIG_HOME', '.config');
  return {
    config: path.join(config, 'config.json'),
    envFile: path.join(config, 'env'),
    state: path.join(base('XDG_STATE_HOME', '.local', 'state'), 'state.json'),
    out: path.join(base('XDG_DATA_HOME', '.local', 'share'), 'episodes'),
  };
}

/** "~/x" means the home directory; relative paths are relative to `dir`. */
export function resolvePath(p: string, dir: string, env: Env): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return path.join(homeDir(env), p.slice(1));
  return path.resolve(dir, p);
}
