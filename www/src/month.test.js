import { describe, expect, it } from 'vitest';
import { currentMonth, todayIso } from './month';

describe('todayIso', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 7, 27, 6, 29))).toBe('2026-08-27');
  });

  it('zero-pads single-digit months and days', () => {
    expect(todayIso(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('reads the local date, not the UTC one', () => {
    // 06:29 on the 27th in a UTC+8 zone is still the 26th in UTC, so
    // `toISOString().slice(0, 10)` would answer 2026-08-26 here. Anyone
    // east of Greenwich would have spending filed a day early every
    // morning -- and on the 1st of a month, filed into the month before,
    // where the current month's budget would never count it.
    const localMorning = new Date(2026, 7, 27, 6, 29);
    expect(todayIso(localMorning)).toBe('2026-08-27');
    expect(todayIso(localMorning).slice(0, 7)).toBe(currentMonth(localMorning));
  });

  it('agrees with currentMonth on the last instant of a month', () => {
    // The pairing that matters: a transaction dated by todayIso must land
    // in the month BudgetTab is showing, or its spend silently vanishes
    // from the budget.
    const lastMoment = new Date(2026, 7, 31, 23, 59);
    expect(todayIso(lastMoment).slice(0, 7)).toBe(currentMonth(lastMoment));

    const firstMoment = new Date(2026, 8, 1, 0, 1);
    expect(todayIso(firstMoment)).toBe('2026-09-01');
    expect(todayIso(firstMoment).slice(0, 7)).toBe(currentMonth(firstMoment));
  });
});
