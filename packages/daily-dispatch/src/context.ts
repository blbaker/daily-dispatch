import type { spawn } from 'node:child_process';

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * Everything an adapter factory may touch outside its own code. The CLI
 * passes the real globals; tests pass a recording fetch, a fake spawn and
 * an instant sleep, so no test reaches the network or a real CLI.
 */
export interface ProviderContext {
  env: Env;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  spawnImpl?: typeof spawn;
  /** Overrides the adapter's default model. */
  model?: string;
  /** The command writer's command line, e.g. "claude -p". */
  command?: string;
}
