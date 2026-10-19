/** Test helpers: a recording fake fetch and a fake child process. No network, no real CLIs. */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn as realSpawn } from 'node:child_process';
import type { WriteRequest } from '../src/writers/types.ts';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  json: unknown;
}

/** A Response with a JSON, text or binary body. */
export function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  if (body instanceof Uint8Array) return new Response(body, { status, headers });
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers });
}

/** Replays the given responses in order and records every request. Throws Errors given in the list. */
export function fakeFetch(...replies: Array<Response | Error>) {
  const calls: RecordedCall[] = [];
  const queue = [...replies];
  const fn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init.body === 'string' ? init.body : undefined;
    let json: unknown;
    try {
      json = body === undefined ? undefined : JSON.parse(body);
    } catch {
      json = undefined;
    }
    calls.push({ url: String(input), method: init.method ?? 'GET', headers, body, json });
    const next = queue.shift();
    if (next === undefined) throw new Error(`fakeFetch: unexpected request #${calls.length} to ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fn as typeof fetch, calls };
}

/** A fetch that fails the test if anything calls it. */
export function forbiddenFetch() {
  const state = { called: 0 };
  const fn = async (input: string | URL | Request): Promise<Response> => {
    state.called += 1;
    throw new Error(`network call during a test that forbids it: ${String(input)}`);
  };
  return { fetch: fn as typeof fetch, state };
}

export interface SpawnCall {
  command: string;
  args: readonly string[];
  stdin: string;
}

/**
 * A fake spawn. Each call records its command, args and everything written
 * to stdin, then exits with the scripted code and output.
 */
export function fakeSpawn(script: { stdout?: string; stderr?: string; code?: number; error?: NodeJS.ErrnoException }) {
  const calls: SpawnCall[] = [];
  const fn = (command: string, args: readonly string[] = []): ChildProcess => {
    const child = new EventEmitter() as ChildProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const call: SpawnCall = { command, args, stdin: '' };
    calls.push(call);
    stdin.on('data', (d: Buffer) => (call.stdin += d.toString()));
    Object.assign(child, { stdin, stdout, stderr, kill: () => true });
    setImmediate(() => {
      if (script.error) {
        child.emit('error', script.error);
        return;
      }
      stdout.end(script.stdout ?? '');
      stderr.end(script.stderr ?? '');
      // A second turn of the event loop lets stdin data written right after
      // spawn() arrive before the process "exits".
      setImmediate(() => child.emit('close', script.code ?? 0, null));
    });
    return child;
  };
  return { spawn: fn as unknown as typeof realSpawn, calls };
}

export const instantSleep = async (): Promise<void> => {};

/** A small write request shared by the prompt and writer tests. */
export const REQ: WriteRequest = {
  stories: [
    { headline: 'Tiny router beats big one', source: 'Example News', summary: 'A $40 router won a speed test.', url: 'https://news.example/router' },
    { headline: 'Rust in the kernel', source: 'Example Wire', summary: 'More drivers land in Rust.', url: 'https://wire.example/rust' },
  ],
  voices: {
    S1: { id: 'v1', name: 'Host 1' },
    S2: { id: 'v2', name: 'Host 2' },
    CALLER_A: { id: 'v3', name: 'Pat, Duluth' },
  },
  title: 'Link Talk',
  listener: { name: 'Sam', town: 'Springfield' },
  targetChars: 6000,
};
