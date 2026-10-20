# Daily podcast episode

Daily Dispatch can make a podcast episode from each day's stories at the same
time every day. It is off by default and nothing runs until you set it up.

The setup has two parts that stay separate on purpose:

- **Settings** say whether the episode is on, what time it is made, in which
  time zone, and which script writer, voice provider and host voices to use.
  They live in the app's Settings screen (stored by the backend at
  `/settings`) or, without a backend, in a local config file.
- **A scheduled job** runs `daily-dispatch podcast run --if-due` every 15
  minutes. Each run reads the settings, and does nothing unless the episode is
  on, the local time is past the set time, and today has no episode yet.

Because the job reads the settings on every run, changing the time in the app
takes effect at the next check. You never reinstall the job to change the time.

## Turn it on

Install the CLI and ffmpeg on the machine that will make the episodes:

```sh
npm install -g @blbaker/daily-dispatch
ffmpeg -version            # macOS: brew install ffmpeg, Debian/Ubuntu: apt install ffmpeg
```

Install it globally rather than running it through `npx`. The scheduled job
stores the path of the CLI script, and the npx cache can be cleared.

### Where the settings come from

If you run the backend, set these two variables and the job uses whatever the
app's Settings screen saved:

```sh
DAILY_DISPATCH_API_URL=https://<your function URL>
DAILY_DISPATCH_API_KEY=<the backend API key>
```

These are the same values the pipeline calls `DIGEST_API_URL` and
`DIGEST_API_KEY`. The day's stories then come from the backend's
`/editions/<date>`.

Without a backend, put the settings in `~/.config/daily-dispatch/config.json`
(`$XDG_CONFIG_HOME/daily-dispatch/config.json` if that is set, or any file you
pass with `--config`):

```json
{
  "podcast": {
    "enabled": true,
    "time": "06:30",
    "timezone": "America/Chicago",
    "writer": "ollama",
    "voice": "local",
    "voices": { "S1": { "id": "af_bella", "name": "Bella" }, "S2": { "id": "am_adam", "name": "Adam" } }
  },
  "stories": "~/digests/{date}.json",
  "out": "~/Podcasts/daily-dispatch",
  "minutes": 10,
  "confirm": false
}
```

| Field | Meaning |
| --- | --- |
| `podcast.enabled` | The on/off switch. Default `false`. |
| `podcast.time` | Local time, 24-hour `HH:MM`. Default `06:00`. |
| `podcast.timezone` | IANA zone such as `America/Chicago`. An unknown zone is an error; it is never treated as UTC. |
| `podcast.writer` | `command` (default, runs `claude -p`), `ollama`, `anthropic` or `openai`. |
| `podcast.voice` | `elevenlabs` (default), `openai`, `google`, `polly`, `azure` or `local`. |
| `podcast.voices` | A voice map like `voices.json`, a path to one, or host name to voice id (`{"Bella": "af_bella"}`, which becomes S1, S2 in order). |
| `stories` | Local digest file; `{date}` becomes `YYYY-MM-DD`. Leave it out to read the backend's edition. |
| `out` | Episodes go in `<out>/<date>/`. Default `~/.local/share/daily-dispatch/episodes`. |
| `minutes`, `title`, `listener` | Episode length, show title, and who sent the links. |
| `model`, `voiceModel`, `writerCommand` | The same as `--model`, `--voice-model` and `--writer-command` on `podcast make`. |
| `confirm` | Must be `true` before a scheduled run calls a paid provider. Default `false`. |

When the backend is configured, its settings decide `enabled`, `time`,
`timezone`, the writer, the voice provider and the host voices. The config
file still supplies the local fields (`stories`, `out`, `confirm` and so on),
and its `podcast.voices` fills in when the app has no host voices saved.

### API keys

Schedulers do not read your shell profile, so keys set in `~/.bashrc` are not
visible to the job. Put them in `~/.config/daily-dispatch/env` instead, one
`KEY=VALUE` per line, and make the file readable only by you:

```sh
chmod 600 ~/.config/daily-dispatch/env
```

A variable that is already set in the environment wins over the file. The
variables each provider reads are listed in the package README.

### Try it by hand first

```sh
daily-dispatch podcast run --dry-run     # prints characters and cost, calls nothing paid
daily-dispatch podcast run               # makes today's episode now
daily-dispatch podcast run --if-due      # what the job runs
```

`podcast run` without `--if-due` ignores the on/off switch and the time, but
still makes at most one episode per date unless you add `--force`.

### Install the job

```sh
daily-dispatch schedule install --print  # shows the files and commands, changes nothing
daily-dispatch schedule install          # registers the job
daily-dispatch schedule status
```

`--every 30m` changes how often the job checks. The default is 15 minutes.

## The schedulers

`schedule install` picks the scheduler for the machine. Pass `--kind` to
choose one yourself, and pass the same `--kind` to `uninstall` and `status`.

Every job runs `node <path to the CLI> podcast run --if-due` with the `PATH`
you had when you installed it, so it can find ffmpeg and any writer CLI. If
you move ffmpeg or reinstall Node somewhere else, run `schedule install`
again. All of them append to `~/.local/state/daily-dispatch/podcast.log`.

### systemd (Linux, preferred when systemd is running)

Writes `~/.config/systemd/user/daily-dispatch-podcast.service` and
`daily-dispatch-podcast.timer`, then runs `systemctl --user daemon-reload` and
`systemctl --user enable --now daily-dispatch-podcast.timer`. The timer uses
`OnCalendar` with `Persistent=true`, so a laptop that slept through a check
runs it on wake.

User timers stop when you log out unless lingering is on:

```sh
loginctl enable-linger "$USER"
systemctl --user list-timers daily-dispatch-podcast.timer
```

### cron (Linux without systemd, or `--kind cron`)

Adds one line to your crontab between two marker comments. Reinstalling
replaces those lines and uninstalling removes only them. cron only repeats at
intervals that divide an hour or a day evenly (5m, 10m, 15m, 20m, 30m, 1h,
2h and so on). cron can start a new check while a long run is still going; a
lock file next to the state file makes the second one skip.

### launchd (macOS)

Writes `~/Library/LaunchAgents/dev.daily-dispatch.podcast.plist` with
`StartInterval` set to the interval, and loads it with
`launchctl bootstrap gui/<uid>`. It runs while you are logged in.

### Task Scheduler (Windows)

Writes `daily-dispatch-podcast.xml` next to the config file and registers it
with `schtasks /Create /TN DailyDispatch\Podcast /XML <file> /F`. The task
repeats every interval, starts late if the computer was off, and never runs two
copies at once. It runs while you are logged in. Task Scheduler cannot redirect
output, so the task passes `--log` and the CLI writes the log itself.

### GitHub Actions (no always-on machine)

Copy `templates/github-actions-daily-podcast.yml` to
`.github/workflows/daily-podcast.yml` in a repository you own, commit a
config file at `daily-dispatch/config.json`, and add your keys as repository
secrets (`AWS_REGION` and `AZURE_SPEECH_REGION` as variables). The workflow
checks once an hour, keeps the state file in the Actions cache, and uploads
each episode as an artifact for 14 days. With the `DAILY_DISPATCH_API_URL` and
`DAILY_DISPATCH_API_KEY` secrets set, it also publishes the episode to the app.

Hosted runners have no Ollama, no local TTS server and no `claude` CLI, so
use the `anthropic` or `openai` writer and a cloud voice, with `"confirm": true`.
GitHub can start scheduled runs late and pauses them after 60 days without a
commit on a public repository. Only the state file is cached, so a run that
fails partway writes a new script on its next try.

## How the time in Settings takes effect

Each check reads the settings fresh, so:

- Turning the episode off in the app stops it from the next check. The job
  keeps running and logs `not due: disabled`.
- Changing the time or time zone applies to the next check. If the new time
  has already passed today and today has no episode, the next check makes one.
- The episode belongs to the local date in the settings' time zone, not the
  UTC date and not the machine's own zone.
- A time inside the hour that daylight saving skips (02:30 on a spring-forward
  day in the US) runs at the first check after the clock jumps. The hour that
  repeats in autumn runs once, because the date is recorded.
- If the machine was asleep or off at the set time, the next check that same
  local day makes the episode. A day that passes completely is not made later.

## Publishing the episode to the app

When `DAILY_DISPATCH_API_URL` and `DAILY_DISPATCH_API_KEY` are set, a run that
makes an episode also publishes it to the backend:

1. `POST /episodes` with the date as the id, a title such as
   `Link Talk: Monday, October 19, 2026`, and the length in seconds. The
   backend replies with a presigned upload URL.
2. `PUT` of `episode.mp3` to that URL. The API key is not sent with it.
3. `POST /episodes` with `{"id": "<date>", "ready": true}`. The backend checks
   that the audio arrived, marks the episode ready and sends the "New episode
   ready" push.

The app finds episodes through the backend. `GET /episodes` lists the ready
ones, newest first, and `GET /episodes/<date>` returns one; both include an
audio URL that works for an hour. The push carries `data.type` `episode`,
`data.id` (the date) and `data.path` (`/episodes/<date>`), so a tap can open
that episode. Without the two variables, and on a `--dry-run`, nothing is
uploaded. Episodes made while the variables were unset are not sent later.

## When something goes wrong

The state file, `~/.local/state/daily-dispatch/state.json`, records each date
as `done` or `failed` with an attempt count, plus the upload's progress when
the backend is set.

- No digest for the date yet, a 404 from `/editions/<date>`, or an edition
  still in progress means "waiting". The next check tries again and no attempt
  is counted.
- A failure after spending could start (a provider error, a network error)
  counts an attempt. A retry reuses the script from the earlier attempt and the
  chunk audio already made, so you do not pay for those twice. After three
  failed attempts the job stops trying until the next date.
- A configuration problem (missing key, unknown provider, no ffmpeg, a paid
  provider without `"confirm": true`) fails before anything is spent and does
  not count as an attempt. It shows in the log on every check until fixed.
- A failed upload does not count as an attempt either, because the audio
  exists. The run exits 1, the upload stays `pending`, and every later check
  retries only the upload until it works. If `episode.mp3` is gone by then (a
  GitHub Actions runner keeps only the state file), the upload is marked
  `gave-up`, and `podcast run --force --date <date>` makes and sends it again.
- `daily-dispatch podcast run --force` makes today's episode regardless of the
  state file.

`daily-dispatch schedule status` shows whether the job is installed, the log
path, and the last three dates.

## Turn it off

To pause it, switch the daily podcast off in the app, or set
`"enabled": false` in the config file. The job keeps checking and does nothing.

To remove the job:

```sh
daily-dispatch schedule uninstall        # add --kind if you installed with one
```

Episodes, the config file, the state file and the log stay where they are.
For the GitHub Actions workflow, delete the workflow file or disable it in the
repository's Actions tab.

## Costs

Paid providers are only called when `"confirm": true` is set, and
`podcast run --dry-run` prints the estimate for your stories without calling
them. The per-episode figures below assume a 10-minute episode of about
10,000 characters (the CLI estimates 1,000 characters per minute of speech).
Prices are list prices checked on 2026-10-19; free tiers and plan credits
lower them.

| Voice provider | List price | 10-minute episode | Source |
| --- | --- | --- | --- |
| `elevenlabs` (Eleven v4, Text-to-Dialogue) | $0.08 per 1,000 characters | about $0.80 | elevenlabs.io/pricing/api |
| `openai` (gpt-4o-mini-tts) | about $0.015 per minute of audio | about $0.15 | developers.openai.com/api/docs/pricing |
| `google` (gemini-3.8-flash-tts) | $9.00 per million audio tokens, $0.00225 per 10 s of audio; doubles on 2027-01-01 | about $0.14 | ai.google.dev/gemini-api/docs/pricing |
| `polly` neural (default engine) | $16 per million characters | about $0.16 | aws.amazon.com/polly/pricing |
| `polly` generative / long-form / standard | $30 / $100 / $4 per million characters | about $0.30 / $1.00 / $0.04 | aws.amazon.com/polly/pricing |
| `azure` (neural voices) | $15 per million characters; the free F0 tier includes 0.5 million a month | about $0.15 | azure.microsoft.com/pricing/details/speech |
| `local` (Kokoro or any OpenAI-compatible server) | free | $0.00 | runs on your machine |

| Script writer | List price | Per episode | Source |
| --- | --- | --- | --- |
| `anthropic` (claude-sonnet-5-5) | $2 input / $10 output per million tokens | a few cents, printed by `--dry-run` | platform.claude.com models overview |
| `openai` (gpt-6.1-sol) | $2 input / $10 output per million tokens | a few cents, printed by `--dry-run` | developers.openai.com/api/docs/pricing |
| `ollama` | free | $0.00 | runs on your machine |
| `command` (`claude -p` by default) | whatever that CLI costs you | not estimated | your CLI's plan |

The GitHub Actions workflow is free on a public repository. On a private
repository it uses about a minute per hourly check, roughly 750 of the 2,000
minutes a month included with GitHub Free (docs.github.com, "GitHub Actions
billing").

The Gemini figure works out as 1.5 audio tokens per character at 1,000
characters per minute, plus a quarter of a text token per character at $0.50
per million. The Polly and Azure figures are characters times the list price.
None of these numbers come from a real billed run; no paid API was called
while building this.
