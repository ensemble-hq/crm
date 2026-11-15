import { describe, expect, it } from 'vitest';
import type { BookingPageSettings } from '../contracts/capture';
import { freeHosts, requestedStart, slotsFor } from './booking';
import { isTimeZone, zonedParts, zonedToUtc } from './zones';

describe('time zones', () => {
  it('turns a day and a clock time somewhere into the instant it happens', () => {
    expect(zonedToUtc('2026-11-17', 9 * 60, 'UTC').toISOString()).toBe('2026-11-17T09:00:00.000Z');
    expect(zonedToUtc('2026-11-17', 9 * 60, 'America/New_York').toISOString()).toBe('2026-11-17T14:00:00.000Z');
    expect(zonedToUtc('2026-07-01', 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc('2026-11-17', 9 * 60 + 30, 'Asia/Kolkata').toISOString()).toBe('2026-11-17T04:00:00.000Z');
    expect(zonedToUtc('2026-11-17', 9 * 60, 'Australia/Sydney').toISOString()).toBe('2026-11-16T22:00:00.000Z');
  });

  it('gets the days the clocks change right', () => {
    // New York goes back an hour on 1 November 2026 and forward on 8 March 2026.
    expect(zonedToUtc('2026-11-01', 9 * 60, 'America/New_York').toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(zonedToUtc('2026-10-31', 9 * 60, 'America/New_York').toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(zonedToUtc('2026-03-08', 9 * 60, 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('shows an instant as the day and time somewhere', () => {
    expect(zonedParts('2026-11-17T14:00:00.000Z', 'America/New_York')).toEqual({ date: '2026-11-17', time: '09:00' });
    expect(zonedParts('2026-11-16T22:00:00.000Z', 'Australia/Sydney')).toEqual({ date: '2026-11-17', time: '09:00' });
  });

  it('knows a real zone from a made-up one', () => {
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('booking times', () => {
  const page: BookingPageSettings = { name: 'Call', hostIds: ['a', 'b'], durationMinutes: 60, days: [1, 2, 3, 4, 5, 6, 7], fromHour: 9, toHour: 11, timeZone: 'America/New_York', attendance: 'turn' };
  const now = new Date('2026-11-16T12:00:00Z');

  it('offers the page\'s hours as instants, on the page\'s own clock', () => {
    const [first] = slotsFor(page, [], now);
    expect(first).toEqual({ date: '2026-11-17', times: ['09:00', '10:00'], starts: ['2026-11-17T14:00:00.000Z', '2026-11-17T15:00:00.000Z'] });
  });

  it('counts someone busy whether they lead a meeting or sit in on it', () => {
    const meetings = [{ hostId: 'a', otherHostIds: ['b'], startsAt: '2026-11-17T14:30:00.000Z', durationMinutes: 60 }];
    expect(freeHosts(['a', 'b', 'c'], 60, '2026-11-17T14:00:00.000Z', meetings)).toEqual(['c']);
    expect(freeHosts(['a', 'b'], 60, '2026-11-17T15:30:00.000Z', meetings)).toEqual(['a', 'b']);
  });

  it('offers a time to a page where everyone attends only when everyone is free', () => {
    const meetings = [{ hostId: 'a', startsAt: '2026-11-17T14:00:00.000Z', durationMinutes: 60 }];
    expect(slotsFor(page, meetings, now)[0]?.times).toEqual(['09:00', '10:00']);
    expect(slotsFor({ ...page, attendance: 'all' }, meetings, now)[0]?.times).toEqual(['10:00']);
  });

  it('reads a requested time as an instant, or as the page\'s own clock', () => {
    expect(requestedStart(page, '2026-11-17T14:00:00.000Z')).toBe('2026-11-17T14:00:00.000Z');
    expect(requestedStart(page, '2026-11-17T09:00')).toBe('2026-11-17T14:00:00.000Z');
    expect(requestedStart(page, 'tomorrow')).toBeUndefined();
  });
});
