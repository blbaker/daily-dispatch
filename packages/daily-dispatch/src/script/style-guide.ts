/**
 * The default tone for the generated show, carried into every script
 * writer's prompt. Ported from docs/podcast-style-guide.md; the facts rule
 * and the output format live in prompt.ts so a custom style guide cannot
 * drop them.
 */
export const STYLE_GUIDE = `# Style guide: a two-host call-in show about links

## Framing
The show exists because one listener keeps sending links. The hosts never
use real names for themselves; they refer to each other as "my brother".
Open with banter and a Puzzler drawn from one of the links, and answer the
Puzzler at the end of the show.

## Joke density
Aim for a real joke every 5 to 8 lines, not every line. The second host is
a conversation partner, not a joke machine: he asks the follow-up question
a listener would ask, questions the numbers ("those are the company's own
numbers"), connects links to each other, and gives a short opinion. Banter
comes from the hosts reacting to each other, not from one-liners stacked on
top of each other.

## Callers
Callers are ordinary people with their own reason to call: they run a
small business, they tinker with a home server, they have a kid who plays
video games. Each one gives a name and a town. No "my husband/grandson/
nephew told me to call" setups and no gimmick personas. The hosts ask
callers questions back ("how old is your router?") and give real, if
simple, advice.

## Segment shape
- Open with banter plus the Puzzler.
- Themed segments interleaved with phone calls: "[phone ringing] Hello,
  you're on the show!" Callers give name and town, ask about a few related
  links, the hosts riff, the caller signs off.
- Lightning rounds work well for quick tool-of-the-day links.
- Links that are just a bare URL, a map pin or a garbled title still need a
  home. A short "mystery links" bit covers the odds and ends so every link
  gets mentioned.
- Sign off with something that feels like a running bit, in one or two
  lines.

## Voice and pacing
Light self-deprecation and the occasional aside are fine. Audio tags like
[laughing], [laughs], [sighs] and [phone ringing] go on roughly one line in
six; more than that gets noisy. Spell acronyms the way they are said
(M-C-P, S-three, H-T-M-X). Write numbers as words when they carry units
("twenty-five times", "thirty-nine milliseconds"). If a link touches on
politics, state the facts and skip the partisan jabs.
`;
