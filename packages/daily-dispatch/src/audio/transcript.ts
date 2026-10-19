import { stripTags } from '../script/parse.ts';
import type { Script, VoiceMap } from '../types.ts';

/** Markdown transcript: speaker names in bold, audio tags removed. */
export function renderTranscript(script: Script, voices: VoiceMap): string {
  const lines = [`# ${script.title}`, ''];
  for (const seg of script.segments) {
    lines.push(`## ${seg.title}`, '');
    for (const turn of seg.turns) {
      const clean = stripTags(turn.text);
      if (clean !== '') lines.push(`**${voices[turn.speaker]?.name ?? turn.speaker}:** ${clean}  `);
    }
    lines.push('');
  }
  return lines.join('\n');
}
