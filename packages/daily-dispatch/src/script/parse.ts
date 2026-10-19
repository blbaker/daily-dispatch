import { DispatchError } from '../errors.ts';
import type { Script, Segment } from '../types.ts';

const HEADING = /^##\s*(.*)$/;
const TURN = /^([A-Z0-9_]+):\s*(.+)$/;
const TAG = /\[[^\]]*\]/g;

/** Remove bracketed audio tags ("[laughs]") and collapse the leftover spaces. */
export function stripTags(text: string): string {
  return text.replace(TAG, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse the script format shared by hand-written scripts and model output:
 *
 *     ## Segment title
 *     S1: [laughing] Line of dialogue
 *
 * Every problem is collected with its line number, so a model can be told
 * everything it got wrong in one retry. Rules:
 *  - a speaker tag must be in `speakers` (the voice map's keys);
 *  - a turn needs words, not just audio tags (the ElevenLabs API rejects a
 *    tag-only turn with 400 input_text_empty);
 *  - one speaker per line;
 *  - every non-blank line is a heading or a turn;
 *  - the script has at least one turn.
 */
export function parseScript(text: string, speakers: readonly string[], title = 'Link Talk'): Script {
  const known = new Set(speakers);
  const segments: Segment[] = [];
  const problems: string[] = [];
  let current: Segment | undefined;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const at = `line ${i + 1}`;
    if (line === '') return;
    const heading = HEADING.exec(line);
    if (heading) {
      const segTitle = (heading[1] ?? '').trim();
      if (segTitle === '') problems.push(`${at}: empty segment title`);
      current = { title: segTitle, turns: [] };
      segments.push(current);
      return;
    }
    const turn = TURN.exec(line);
    if (!turn) {
      problems.push(`${at}: not a "## heading" or "TAG: text" line: ${line.slice(0, 60)}`);
      return;
    }
    const speaker = turn[1] ?? '';
    const words = (turn[2] ?? '').trim();
    if (!known.has(speaker)) {
      problems.push(`${at}: unknown speaker "${speaker}" (allowed: ${speakers.join(', ')})`);
      return;
    }
    if (stripTags(words) === '') {
      problems.push(`${at}: tag-only turn; add words after the tag: ${line.slice(0, 60)}`);
      return;
    }
    // "S1: Hello! CALLER_A: Hi" would voice the caller in S1's voice and read
    // the tag aloud. Each turn gets its own line.
    const second = speakers.find((s) => new RegExp(`\\b${s}:`).test(words));
    if (second !== undefined) {
      problems.push(`${at}: two speakers on one line (found "${second}:"); put each turn on its own line`);
      return;
    }
    if (current === undefined) {
      current = { title: 'Intro', turns: [] };
      segments.push(current);
    }
    current.turns.push({ speaker, text: words });
  });

  if (problems.length === 0 && !segments.some((s) => s.turns.length > 0)) {
    problems.push('the script has no turns');
  }
  if (problems.length > 0) {
    throw new DispatchError('script-parse', `script has ${problems.length} problem(s)`, problems);
  }
  return { title, segments: segments.filter((s) => s.turns.length > 0) };
}

/** Inverse of parseScript: the text form saved as script.txt. */
export function formatScript(script: Script): string {
  return script.segments
    .map((seg) => [`## ${seg.title}`, ...seg.turns.map((t) => `${t.speaker}: ${t.text}`)].join('\n'))
    .join('\n\n') + '\n';
}
