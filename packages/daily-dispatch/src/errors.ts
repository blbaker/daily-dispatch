/**
 * Every failure the library reports carries a `kind`, so callers (the CLI,
 * a scheduler, an app) can give each cause its own message instead of one
 * "something went wrong" for six different problems.
 */
export type ErrorKind =
  | 'usage' // bad CLI arguments
  | 'invalid-input' // stories.json / voices.json / script file is malformed
  | 'script-parse' // the script text broke a format rule
  | 'turn-too-long' // one turn is longer than the provider accepts per request
  | 'unknown-provider'
  | 'no-key' // the provider's API key env var is not set
  | 'unauthorized' // the provider rejected the key (401/403)
  | 'rate-limited' // 429 that outlasted the retries
  | 'http' // any other non-2xx response
  | 'network' // fetch threw: DNS, refused connection, timeout
  | 'bad-response' // 2xx but the body is not what the provider documents
  | 'budget' // the account cannot cover the characters this episode needs
  | 'command-failed' // the command writer's CLI exited non-zero or timed out
  | 'ffmpeg-missing'
  | 'ffmpeg-failed'
  | 'upload-failed'; // the episode exists, but publishing it to the backend did not finish

export class DispatchError extends Error {
  readonly kind: ErrorKind;
  readonly details: readonly string[];

  constructor(kind: ErrorKind, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'DispatchError';
    this.kind = kind;
    this.details = details;
  }
}

export function isDispatchError(e: unknown, kind?: ErrorKind): e is DispatchError {
  return e instanceof DispatchError && (kind === undefined || e.kind === kind);
}
