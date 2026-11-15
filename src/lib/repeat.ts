/** How often a task comes round again once it is done. */
export const REPEATS = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Every week' },
  { id: 'monthly', label: 'Every month' },
  { id: 'quarterly', label: 'Every quarter' },
] as const;

/**
 * When a repeating task is next due: one step on from when it was due, or from today if it was
 * finished late, so a task a month overdue does not come straight back overdue again.
 * Dates are `YYYY-MM-DD`. Returns nothing for a rhythm it does not know.
 */
export function nextDue(repeat: string, due: string | null, today: string): string | undefined {
  const from = new Date(`${due && due > today ? due : today}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return undefined;
  if (repeat === 'daily') from.setUTCDate(from.getUTCDate() + 1);
  else if (repeat === 'weekly') from.setUTCDate(from.getUTCDate() + 7);
  else if (repeat === 'monthly' || repeat === 'quarterly') {
    const day = from.getUTCDate();
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() + (repeat === 'monthly' ? 1 : 3));
    // The 31st of a month that has no 31st is its last day.
    from.setUTCDate(Math.min(day, new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate()));
  } else return undefined;
  return from.toISOString().slice(0, 10);
}
