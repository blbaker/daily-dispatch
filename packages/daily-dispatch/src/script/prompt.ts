import { roleOf } from '../voices-file.ts';
import { STYLE_GUIDE } from './style-guide.ts';
import type { Prompt, WriteRequest } from '../writers/types.ts';

interface Speaker {
  tag: string;
  name: string;
  role: 'host' | 'caller';
}

/**
 * Format rules with an example written in the real speaker tags. A literal
 * placeholder such as "TAG: text" gets copied verbatim by small local models.
 */
function formatRules(speakers: readonly Speaker[]): string {
  const hosts = speakers.filter((s) => s.role === 'host');
  const one = hosts[0]?.tag ?? speakers[0]?.tag ?? 'S1';
  const two = hosts[1]?.tag ?? one;
  const caller = speakers.find((s) => s.role === 'caller')?.tag;
  const example = [
    '## Opening',
    `${one}: ...`,
    `${two}: ...`,
    ...(caller === undefined ? [] : ['', '## A call about the first links', `${one}: [phone ringing] Hello, you're on the show!`, `${caller}: ...`]),
  ].join('\n');
  return `## Output format (strict)
Output only the script: no preamble, no markdown fences, no notes after it.
- Start each segment with a line "## Segment title". Use a segment for the
  opening, one for each theme or phone call, and one for the sign-off.
- Every other line starts with one of the speaker tags above, a colon, and
  what that speaker says.
- Put each turn on its own line. When a caller answers the phone, that is a
  new line starting with the caller's tag.
- Every turn needs spoken words. A line that is only an audio tag, such as
  "${two}: [laughs]", is invalid.
- Keep each turn under 500 characters.
- Audio tags go in square brackets inside a turn: [laughing], [laughs],
  [sighs], [phone ringing].

Example of the layout. Write your own words where it says "...":

${example}`;
}

const FACTS_RULES = `## Facts
Every fact must come from the stories in the user message. Do not add
facts, numbers, names, dates or quotes that are not in them. If a story is
thin, say so on air instead of filling it in. Mention every story at least
once.`;

const chars = (n: number): string => n.toLocaleString('en-US');

/**
 * Build the system and user messages every writer sends. The style guide is
 * swappable; the format and facts rules are not, because the parser and the
 * "every fact comes from the stories" promise depend on them.
 */
export function buildPrompt(req: WriteRequest): Prompt {
  const speakers: Speaker[] = Object.entries(req.voices).map(([tag, v]) => ({ tag, name: v.name, role: roleOf(tag, v) }));
  const callers = speakers.filter((s) => s.role === 'caller');
  const system = [
    `You write the script for "${req.title}", a two-host call-in radio show that works through a pile of links one listener sent in.`,
    (req.styleGuide ?? STYLE_GUIDE).trim(),
    '## Speakers\nUse only these speaker tags:\n' + speakers.map((s) => `- ${s.tag}: ${s.name} (${s.role})`).join('\n'),
    callers.length === 0
      ? 'There are no callers today: skip the phone calls.'
      : `Every caller, whoever they are, speaks with one of these tags: ${callers.map((c) => c.tag).join(', ')}. Never invent a tag that is not in the list above; two different people may call using the same tag.`,
    formatRules(speakers),
    FACTS_RULES,
    `## Length\nAim for about ${chars(req.targetChars)} characters of dialogue (about ${Math.max(1, Math.round(req.targetChars / 1000))} minutes of audio).`,
  ].join('\n\n');

  const who = req.listener.name ? `${req.listener.name}, out in ${req.listener.town || 'parts unknown'}` : 'a listener, out there somewhere';
  const stories = req.stories
    .map((s, i) => `[${i + 1}] ${s.headline || '(no headline)'} | ${s.source}\n${s.summary || '(no summary)'}\nURL: ${s.url || '(none)'}`)
    .join('\n\n');
  const user = `The links today came from ${who}.\n\nStories (${req.stories.length}):\n\n${stories}\n\nWrite the full script now.`;

  // Tokens run about 4 characters each in English; budget for 1 in 3 plus
  // headroom so a long script is not cut off mid-sentence.
  const maxOutputTokens = Math.min(32000, Math.ceil(req.targetChars / 3) + 1024);
  return { system, user, maxOutputTokens };
}

const ONLY_TAGS = /^(?:\s*\[[^\]]*\])+\s*$/;
const TURN_START = /^([A-Z0-9_]+):\s*(.*)$/;

/**
 * Models wrap scripts in markdown fences, add a friendly preamble, bold the
 * speaker tags, put a sound cue such as "[phone ringing]" on a line of its
 * own, or give a speaker a turn that is only "[laughs]". Undo those habits.
 * None of the repairs adds, removes or reassigns a spoken word: a lone cue
 * moves onto the next turn, and a turn with no words is dropped. Anything
 * else is left for the parser to reject, so the writer can retry with the
 * specific problems.
 */
export function cleanModelOutput(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .filter((l) => !/^\s*```/.test(l))
    .map((l) => l.replace(/^\s*\*\*([A-Z0-9_]+)(?::\*\*|\*\*:)/, '$1:').replace(/^(\s*##\s*)segment title:\s*/i, '$1'));
  const first = lines.findIndex((l) => /^\s*##/.test(l));
  const out: string[] = [];
  let cue = '';
  for (const line of first > 0 ? lines.slice(first) : lines) {
    const trimmed = line.trim();
    const turn = TURN_START.exec(trimmed);
    if (ONLY_TAGS.test(trimmed)) {
      cue = `${cue}${trimmed} `;
    } else if (turn !== null && ONLY_TAGS.test(turn[2] ?? '')) {
      continue;
    } else if (turn !== null && cue !== '') {
      out.push(`${turn[1]}: ${cue}${turn[2]}`);
      cue = '';
    } else {
      out.push(line);
    }
  }
  return out.join('\n').trim();
}
