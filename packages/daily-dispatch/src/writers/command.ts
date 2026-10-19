import { spawn } from 'node:child_process';
import { DispatchError } from '../errors.ts';
import { textWriter } from './types.ts';
import type { ScriptWriter, WriterFactory } from './types.ts';

export const DEFAULT_COMMAND = 'claude -p';
const TIMEOUT_MS = 20 * 60 * 1000;

/** Split a command line on spaces, honouring single and double quotes. No other shell syntax. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/**
 * Runs any CLI that reads a prompt on stdin and prints the reply on stdout.
 * The default is `claude -p`. Whatever the CLI costs is between the user and
 * that CLI, so this writer counts as free and also runs in a dry run.
 */
export const createCommandWriter: WriterFactory = (ctx): ScriptWriter => {
  const line = ctx.command ?? ctx.env['DAILY_DISPATCH_WRITER_COMMAND'] ?? DEFAULT_COMMAND;
  const [command = '', ...args] = splitCommand(line);
  const run = ctx.spawnImpl ?? spawn;
  return textWriter({ name: 'command', paid: false }, (prompt, signal) =>
    new Promise<string>((resolve, reject) => {
      const child = run(command, args, { stdio: ['pipe', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new DispatchError('command-failed', `"${line}" did not finish within ${TIMEOUT_MS / 60000} minutes`));
      }, TIMEOUT_MS);
      timer.unref();
      child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        const why = e.code === 'ENOENT' ? `"${command}" was not found on PATH` : e.message;
        reject(new DispatchError('command-failed', `script writer command failed: ${why}. Install it or pass --writer-command.`));
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new DispatchError('command-failed', `"${line}" exited with code ${code}: ${err.trim().slice(-300)}`));
      });
      child.stdin?.on('error', () => {}); // the close handler reports the real failure
      child.stdin?.end(`${prompt.system}\n\n${prompt.user}\n`);
    }),
  );
};
