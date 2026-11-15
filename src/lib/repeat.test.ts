import { describe, expect, it } from 'vitest';
import { nextDue } from './repeat';

describe('when a repeating task is next due', () => {
  it('steps on from when it was due', () => {
    expect(nextDue('daily', '2026-11-20', '2026-11-15')).toBe('2026-11-21');
    expect(nextDue('weekly', '2026-11-20', '2026-11-15')).toBe('2026-11-27');
    expect(nextDue('monthly', '2026-11-20', '2026-11-15')).toBe('2026-12-20');
    expect(nextDue('quarterly', '2026-11-20', '2026-11-15')).toBe('2027-02-20');
  });

  it('steps on from today when it was finished late, or had no date', () => {
    expect(nextDue('weekly', '2026-10-01', '2026-11-15')).toBe('2026-11-22');
    expect(nextDue('daily', null, '2026-11-15')).toBe('2026-11-16');
  });

  it('lands on the last day of a shorter month', () => {
    expect(nextDue('monthly', '2027-01-31', '2026-11-15')).toBe('2027-02-28');
  });

  it('knows nothing of a rhythm it was not given', () => {
    expect(nextDue('yearly', '2026-11-20', '2026-11-15')).toBeUndefined();
  });
});
