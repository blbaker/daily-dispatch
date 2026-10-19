import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, localTime, parseHhmm } from '../src/schedule/clock.ts';
import { isDispatchError } from '../src/errors.ts';
import type { DayRecord } from '../src/schedule/clock.ts';

const at = (iso: string) => new Date(iso);
const chicago = { enabled: true, time: '06:30', timezone: 'America/Chicago' };
const none = (): DayRecord | undefined => undefined;

test('localTime: converts an instant to the wall clock of the zone', () => {
  assert.deepEqual(localTime(at('2026-10-19T11:45:00Z'), 'America/Chicago'), { date: '2026-10-19', minutes: 6 * 60 + 45 });
  assert.deepEqual(localTime(at('2026-10-19T11:45:00Z'), 'UTC'), { date: '2026-10-19', minutes: 11 * 60 + 45 });
  assert.deepEqual(localTime(at('2026-10-19T23:30:00Z'), 'Asia/Tokyo'), { date: '2026-10-20', minutes: 8 * 60 + 30 });
});

test('a disabled schedule never runs, whatever the time', () => {
  const d = decide({ ...chicago, enabled: false }, at('2026-10-19T18:00:00Z'), none);
  assert.equal(d.due, false);
  assert.equal(d.reason, 'disabled');
});

test('before the local time it waits; at and after the time it is due', () => {
  const before = decide(chicago, at('2026-10-19T11:29:00Z'), none); // 06:29 CDT
  assert.equal(before.due, false);
  assert.equal(before.reason, 'before-time');
  const onTime = decide(chicago, at('2026-10-19T11:30:00Z'), none); // 06:30 CDT
  assert.equal(onTime.due, true);
  assert.equal(onTime.date, '2026-10-19');
  const late = decide(chicago, at('2026-10-19T22:00:00Z'), none); // 17:00, machine was asleep
  assert.equal(late.due, true, 'a missed time still runs later the same local day');
});

test('a date that already has an episode is not run again', () => {
  const done = (date: string): DayRecord | undefined => (date === '2026-10-19' ? { status: 'done', attempts: 1 } : undefined);
  const d = decide(chicago, at('2026-10-19T15:00:00Z'), done);
  assert.equal(d.due, false);
  assert.equal(d.reason, 'already-done');
  assert.equal(decide(chicago, at('2026-10-20T15:00:00Z'), done).due, true, 'the next day runs');
});

test('three failed attempts on a date stop retries until the next date', () => {
  const failed = (n: number) => (): DayRecord => ({ status: 'failed', attempts: n });
  assert.equal(decide(chicago, at('2026-10-19T15:00:00Z'), failed(2)).due, true);
  const d = decide(chicago, at('2026-10-19T15:00:00Z'), failed(3));
  assert.equal(d.due, false);
  assert.equal(d.reason, 'gave-up');
});

test('timezone edge: the local date, not the UTC date, names the episode', () => {
  const la = { enabled: true, time: '23:30', timezone: 'America/Los_Angeles' };
  // 06:45Z on Oct 20 is 23:45 on Oct 19 in Los Angeles.
  const d = decide(la, at('2026-10-20T06:45:00Z'), none);
  assert.equal(d.due, true);
  assert.equal(d.date, '2026-10-19');
  // 07:15Z is 00:15 on Oct 20 there: a new local day, and well before 23:30.
  const next = decide(la, at('2026-10-20T07:15:00Z'), none);
  assert.equal(next.due, false);
  assert.equal(next.reason, 'before-time');
  assert.equal(next.date, '2026-10-20');
  // East of UTC: 15:10Z on Oct 19 is already 00:10 on Oct 20 in Auckland (NZDT, +13).
  const nz = decide({ enabled: true, time: '00:05', timezone: 'Pacific/Auckland' }, at('2026-10-19T11:10:00Z'), none);
  assert.equal(nz.due, true);
  assert.equal(nz.date, '2026-10-20');
});

test('DST spring forward: a time inside the skipped hour runs at the first poll after the jump', () => {
  // 2026-03-08 in Chicago: 01:59 CST is followed by 03:00 CDT; 02:30 never happens.
  const spring = { enabled: true, time: '02:30', timezone: 'America/Chicago' };
  assert.equal(decide(spring, at('2026-03-08T07:59:00Z'), none).due, false); // 01:59 CST
  const d = decide(spring, at('2026-03-08T08:00:00Z'), none); // 03:00 CDT
  assert.equal(d.due, true);
  assert.equal(d.date, '2026-03-08');
});

test('DST fall back: the repeated hour runs once, because the date is recorded', () => {
  // 2026-11-01 in Chicago: 01:00-01:59 happens twice (CDT, then CST).
  const fall = { enabled: true, time: '01:30', timezone: 'America/Chicago' };
  const first = decide(fall, at('2026-11-01T06:30:00Z'), none); // 01:30 CDT
  assert.equal(first.due, true);
  assert.equal(first.date, '2026-11-01');
  const done = (): DayRecord => ({ status: 'done', attempts: 1 });
  const second = decide(fall, at('2026-11-01T07:30:00Z'), done); // 01:30 CST, an hour later
  assert.equal(second.due, false);
  assert.equal(second.reason, 'already-done');
});

test('an unknown timezone or a malformed time is refused, never defaulted to UTC', () => {
  assert.throws(() => decide({ ...chicago, timezone: 'America/Chicgo' }, at('2026-10-19T12:00:00Z'), none), (e) => isDispatchError(e, 'invalid-input') && /America\/Chicgo/.test(e.message));
  assert.throws(() => decide({ ...chicago, timezone: '' }, at('2026-10-19T12:00:00Z'), none), (e) => isDispatchError(e, 'invalid-input'));
  for (const bad of ['6:30', '24:00', '06:60', '0630', '']) {
    assert.throws(() => parseHhmm(bad), (e) => isDispatchError(e, 'invalid-input'), bad);
  }
  assert.equal(parseHhmm('00:00'), 0);
  assert.equal(parseHhmm('23:59'), 23 * 60 + 59);
});
