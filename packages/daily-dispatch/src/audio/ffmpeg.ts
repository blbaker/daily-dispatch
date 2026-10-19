import { spawn } from 'node:child_process';
import { DispatchError } from '../errors.ts';
import type { Env } from '../context.ts';

export interface Ffmpeg {
  /** Fails with "ffmpeg-missing" when the binary cannot be started. */
  check(): Promise<void>;
  run(args: readonly string[]): Promise<void>;
  /** Duration in seconds, via ffprobe. */
  duration(file: string): Promise<number>;
}

interface Exit {
  code: number | null;
  stdout: string;
  stderr: string;
}

const MISSING = (bin: string, envVar: string): DispatchError =>
  new DispatchError(
    'ffmpeg-missing',
    `${bin} was not found. Install ffmpeg (https://ffmpeg.org/download.html, or your package manager) or set ${envVar} to the binary.`,
  );

/** Thin wrapper over the ffmpeg and ffprobe binaries (FFMPEG_PATH / FFPROBE_PATH override PATH). */
export function createFfmpeg(opts: { env: Env; spawnImpl?: typeof spawn }): Ffmpeg {
  const run = opts.spawnImpl ?? spawn;
  const ffmpeg = opts.env['FFMPEG_PATH']?.trim() || 'ffmpeg';
  const ffprobe = opts.env['FFPROBE_PATH']?.trim() || 'ffprobe';

  const exec = (bin: string, envVar: string, args: readonly string[]): Promise<Exit> =>
    new Promise((resolve, reject) => {
      const child = run(bin, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (e: NodeJS.ErrnoException) =>
        reject(e.code === 'ENOENT' ? MISSING(bin === ffmpeg ? 'ffmpeg' : 'ffprobe', envVar) : e),
      );
      child.on('close', (code: number | null) => resolve({ code, stdout, stderr }));
    });

  const ok = async (bin: string, envVar: string, args: readonly string[]): Promise<Exit> => {
    const r = await exec(bin, envVar, args);
    if (r.code !== 0) {
      throw new DispatchError('ffmpeg-failed', `${bin} ${args.slice(0, 6).join(' ')} ... exited ${r.code}: ${r.stderr.trim().slice(-400)}`);
    }
    return r;
  };

  return {
    check: async () => void (await ok(ffmpeg, 'FFMPEG_PATH', ['-version'])),
    run: async (args) => void (await ok(ffmpeg, 'FFMPEG_PATH', args)),
    async duration(file) {
      const r = await ok(ffprobe, 'FFPROBE_PATH', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
      return Number.parseFloat(r.stdout.trim()) || 0;
    },
  };
}
