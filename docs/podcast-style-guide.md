# Link Talk style guide

This is the default tone and structure for the "Link Talk" podcast generator:
two hosts, Car Talk-brothers style, working through a pile of links one
listener pushed during the day. Treat it as a starting point. Edit it, or
write your own style doc and point `.claude/skills/link-talk-podcast` at it.

## Framing

The show exists because `{LISTENER_NAME}`, out in `{LISTENER_TOWN}`, keeps
sending links. The hosts never use real names for themselves; they refer to
each other as "my brother." Open with banter and a Puzzler drawn from one of
the links, and answer the Puzzler at the end.

Set `LISTENER_NAME` and `LISTENER_TOWN` as environment variables (see
`.env.pipeline.example`) so the script generator can fill them in. Leave them
unset and the show just says "a listener, out there somewhere," which still
works, just a little blander.

## Joke density

Cut the joke rate roughly in half compared to your first draft. Aim for a
real joke every 5 to 8 lines, not every line. The second host is a
conversation partner, not a joke machine: he asks the follow-up question a
listener would ask, questions the numbers, connects links to each other, and
gives a short opinion. Banter comes from the hosts reacting to each other,
not from one-liners stacked on top of each other.

## Callers

Callers are ordinary people with their own reason to call: they run a small
business, they tinker with a home server, they have a kid who plays video
games. Give each one a name and a town. Avoid "my husband/grandson/nephew
told me to call" setups, and avoid gimmick personas. Hosts ask callers
questions back ("how old is your router?") and give real, if simple, advice.

## Segment shape

- Open with banter plus a Puzzler from one of the links.
- Themed segments interleaved with phone calls: "[phone ringing] Hello,
  you're on Link Talk!" Callers give name and town, ask about a few related
  links, the hosts riff, caller signs off.
- Lightning rounds work well for quick tool-of-the-day links.
- Links that are just a bare URL, a map pin, or a garbled title still need a
  home. A short "mystery links" bit covers the odds and ends so every link
  gets mentioned.
- Sign off with something that feels like a running bit; keep it to one or
  two lines, not a laundry list of fake staff credits.

## Voice and pacing

Light self-deprecation and the occasional aside are fine. Audio tags like
`[laughing]`, `[laughs]`, `[sighs]`, `[phone ringing]` work well on roughly
one line in six; much more than that starts to feel noisy. Spell acronyms
the way they're said (`M-C-P`, `S-three`, `H-T-M-X`). Write numbers as words
when they carry units ("twenty-five times", "thirty-nine milliseconds").
Keep politics, if any links touch on it, to stated facts, no partisan jabs.

Rough pacing: about 16 to 17 characters per second of audio, so characters
divided by 1000 is roughly the runtime in minutes. A 32,000-character script
runs about 33 minutes.

## Script format reminder

See `pipeline/podcast_make.py`'s docstring for the exact `.txt` format
(`## Segment title` then `TAG: text` lines) and `pipeline/voices.example.json`
for the voice map shape.
