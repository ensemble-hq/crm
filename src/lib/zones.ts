/**
 * Time zones, with nothing but what the browser and Node already know. A moment is always kept as
 * an instant (`2026-11-17T15:30:00.000Z`); a time zone only decides how it is worked out from, or
 * shown as, a day and a clock time somewhere.
 */

/** How far ahead of UTC a zone is at a moment, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return (Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

/** The instant at which a zone's clock shows `minutes` past midnight on `date` (`2026-11-17`). */
export function zonedToUtc(date: string, minutes: number, timeZone: string): Date {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  // The offset depends on the moment, which is what is being worked out, so settle it in two steps. That is enough either side of a clock change.
  const first = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  return new Date(wall - offsetMinutes(new Date(first), timeZone) * 60_000);
}

/** The day (`2026-11-17`) and clock time (`15:30`) a zone shows at an instant. */
export function zonedParts(instant: Date | string, timeZone: string): { date: string; time: string } {
  const moment = typeof instant === 'string' ? new Date(instant) : instant;
  const shifted = new Date(moment.getTime() + offsetMinutes(moment, timeZone) * 60_000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows, for a picker. */
export function timeZones(): string[] {
  const known = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return known.includes('UTC') ? known : ['UTC', ...known];
}

/** The zone of whoever is looking. */
export const myTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** A zone as people say it: "Europe/London" becomes "London". */
export const zoneName = (timeZone: string): string => (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
