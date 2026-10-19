import { DispatchError } from '../errors.ts';

/** What the state file remembers about one local date. */
export interface DayRecord {
  status: 'done' | 'failed';
  attempts: number;
  at?: string;
  episode?: string;
  /** Length of the finished episode, when ffprobe could read it. */
  durationSec?: number;
  error?: string;
  /** Only present when the episode was made with the backend configured. */
  upload?: UploadRecord;
}

/**
 * Publishing a made episode to the backend. Kept apart from the day's own
 * status: a failed upload must not cost a writer or voice attempt, because
 * the audio already exists.
 */
export interface UploadRecord {
  /** gave-up: the audio file is gone, so retrying cannot work. */
  status: 'pending' | 'done' | 'gave-up';
  attempts: number;
  at?: string;
  error?: string;
}

export interface ScheduleWindow {
  enabled: boolean;
  /** "HH:MM", 24-hour, in `timezone`. */
  time: string;
  /** IANA zone, for example "America/Chicago". */
  timezone: string;
}

export interface LocalTime {
  /** YYYY-MM-DD in the zone: the date printed on the episode. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

export type Decision =
  | { due: true; date: string }
  | { due: false; date?: string; reason: 'disabled' | 'before-time' | 'already-done' | 'gave-up' };

/** Failed attempts on one date before the job stops retrying until the next date. */
export const MAX_ATTEMPTS = 3;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHhmm(time: string): number {
  const m = HHMM.exec(time);
  if (m === null) throw new DispatchError('invalid-input', `podcast time "${time}" must be HH:MM, 24-hour, like 06:30`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * The wall clock in `timeZone` at `now`. An unknown zone is an error: falling
 * back to UTC or to this machine's zone would publish the episode hours off
 * with nothing on screen saying so.
 */
export function localTime(now: Date, timeZone: string): LocalTime {
  let fmt: Intl.DateTimeFormat;
  try {
    if (timeZone.trim() === '') throw new RangeError('empty');
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new DispatchError('invalid-input', `podcast timezone "${timeZone}" is not an IANA time zone such as America/Chicago`);
  }
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p['year']}-${p['month']}-${p['day']}`, minutes: Number(p['hour']) * 60 + Number(p['minute']) };
}

/**
 * Is an episode due? Compares the local wall clock with the configured
 * time, so a time inside a skipped DST hour fires at the first poll after
 * the jump, and the repeated hour in autumn fires once because the date is
 * recorded. A run that missed its time (machine asleep) still fires later
 * the same local day; a missed day is not made up.
 */
export function decide(s: ScheduleWindow, now: Date, record: (date: string) => DayRecord | undefined): Decision {
  const target = parseHhmm(s.time);
  const local = localTime(now, s.timezone);
  if (!s.enabled) return { due: false, reason: 'disabled' };
  if (local.minutes < target) return { due: false, date: local.date, reason: 'before-time' };
  const day = record(local.date);
  if (day?.status === 'done') return { due: false, date: local.date, reason: 'already-done' };
  if (day !== undefined && day.attempts >= MAX_ATTEMPTS) return { due: false, date: local.date, reason: 'gave-up' };
  return { due: true, date: local.date };
}
