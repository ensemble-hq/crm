import type { BookingPageSettings, DaySlots } from '../contracts/capture';
import { zonedParts, zonedToUtc } from './zones';

/**
 * Which times a booking page can offer. The page's hours are in the page's own time zone; every
 * time offered is an instant, so someone booking from another zone sees it on their own clock and
 * two pages in different zones can never put one person in two places.
 */

/** A meeting someone already has. */
export type Busy = { hostId: string; otherHostIds?: string[] | null; startsAt: string; durationMinutes: number };

const DAY = 86_400_000;
const pad = (value: number) => String(value).padStart(2, '0');

/** The hosts free at a moment: those with no meeting overlapping it, whether they lead it or sit in. */
export function freeHosts(hostIds: string[], durationMinutes: number, startsAt: string, meetings: Busy[]): string[] {
  const start = Date.parse(startsAt);
  const end = start + durationMinutes * 60_000;
  return hostIds.filter((hostId) => !meetings.some((meeting) => (meeting.hostId === hostId || (meeting.otherHostIds ?? []).includes(hostId)) && Date.parse(meeting.startsAt) < end && Date.parse(meeting.startsAt) + meeting.durationMinutes * 60_000 > start));
}

/** Whether a page can offer a moment: someone is free when they take turns, everyone is when they all attend. */
export function canOffer(page: BookingPageSettings, free: string[]): boolean {
  return page.attendance === 'all' ? free.length === page.hostIds.length : free.length > 0;
}

/** The free times on a page for its next eight open days, starting tomorrow where the page is. */
export function slotsFor(page: BookingPageSettings, meetings: Busy[], now: Date): DaySlots[] {
  const today = zonedParts(now, page.timeZone).date;
  const days: DaySlots[] = [];
  for (let offset = 1; days.length < 8 && offset < 40; offset += 1) {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY);
    const date = day.toISOString().slice(0, 10);
    if (!page.days.includes(day.getUTCDay() || 7)) continue;
    const times: string[] = [];
    const starts: string[] = [];
    for (let minutes = page.fromHour * 60; minutes + page.durationMinutes <= page.toHour * 60; minutes += page.durationMinutes) {
      const start = zonedToUtc(date, minutes, page.timeZone).toISOString();
      if (!canOffer(page, freeHosts(page.hostIds, page.durationMinutes, start, meetings))) continue;
      times.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
      starts.push(start);
    }
    if (times.length > 0) days.push({ date, times, starts });
  }
  return days;
}

/** The instant a visitor asked for: either an instant already, or a day and time on the page's own clock. */
export function requestedStart(page: BookingPageSettings, startsAt: string): string | undefined {
  if (/Z$|[+-]\d\d:\d\d$/.test(startsAt)) return Number.isNaN(Date.parse(startsAt)) ? undefined : new Date(startsAt).toISOString();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(startsAt);
  return match ? zonedToUtc(match[1] as string, Number(match[2]) * 60 + Number(match[3]), page.timeZone).toISOString() : undefined;
}
