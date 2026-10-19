import { DispatchError, isDispatchError } from '../errors.ts';
import { buildPrompt, cleanModelOutput } from '../script/prompt.ts';
import { parseScript } from '../script/parse.ts';
import type { ProviderContext } from '../context.ts';
import type { Script, Story, VoiceMap } from '../types.ts';

export interface WriteRequest {
  stories: readonly Story[];
  /** Speaker tags the script may use, with display names and roles. */
  voices: VoiceMap;
  title: string;
  listener: { name?: string; town?: string };
  /** Rough script length in characters; about 1,000 per minute of audio. */
  targetChars: number;
  /** Replaces the built-in style guide. The format and facts rules stay. */
  styleGuide?: string;
}

export interface Prompt {
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface WriterInfo {
  readonly name: string;
  /** Paid writers never run without --confirm. */
  readonly paid: boolean;
  /** Env var holding the API key, if the writer needs one. */
  readonly keyEnv?: string;
  /** US dollars per million tokens, for the dry-run estimate. */
  readonly price?: { inputPerMTok: number; outputPerMTok: number; source: string };
}

/** Turns the day's stories into a validated Script. */
export interface ScriptWriter extends WriterInfo {
  write(req: WriteRequest, signal?: AbortSignal): Promise<Script>;
}

/** Sends a prompt to a model and returns its raw text. Adapters implement only this. */
export type Complete = (prompt: Prompt, signal?: AbortSignal) => Promise<string>;

export type WriterFactory = (ctx: ProviderContext) => ScriptWriter;

/**
 * Wrap a raw text completion into a ScriptWriter: build the prompt, clean
 * up the reply, parse it, and on a parse failure ask once more with the
 * list of problems. A model that breaks the format twice is an error, not
 * a best guess.
 */
export function textWriter(info: WriterInfo, complete: Complete, attempts = 2): ScriptWriter {
  return {
    ...info,
    async write(req: WriteRequest, signal?: AbortSignal): Promise<Script> {
      const base = buildPrompt(req);
      const speakers = Object.keys(req.voices);
      let prompt = base;
      let lastError: DispatchError | undefined;
      for (let i = 0; i < attempts; i++) {
        const raw = await complete(prompt, signal);
        const cleaned = cleanModelOutput(raw);
        try {
          return parseScript(cleaned, speakers, req.title);
        } catch (e) {
          if (!isDispatchError(e, 'script-parse')) throw e;
          lastError = e;
          const problems = e.details.slice(0, 20).map((d) => `- ${d}`).join('\n');
          // Fixing a given text works better than regenerating from scratch,
          // especially for small local models.
          prompt = {
            ...base,
            user: `${base.user}\n\nYour previous script:\n${cleaned}\n\nIt could not be used because:\n${problems}\n\nReturn the corrected full script, following the output format exactly.`,
          };
        }
      }
      throw new DispatchError(
        'script-parse',
        `${info.name} returned an unusable script ${attempts} times: ${lastError?.details[0] ?? 'unknown problem'}`,
        lastError?.details ?? [],
      );
    },
  };
}
