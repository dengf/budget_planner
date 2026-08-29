import { describe, expect, it } from 'vitest';
import { currentMonth, shiftMonth, todayIso, weekLabel, weeksInMonth } from './month';

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

describe('shiftMonth', () => {
  it('steps forward within a year', () => {
    expect(shiftMonth('2026-03', 1)).toBe('2026-04');
  });

  it('steps backward within a year', () => {
    expect(shiftMonth('2026-03', -1)).toBe('2026-02');
  });

  it('rolls over into the next year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('rolls back into the previous year', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('steps by more than one month at once, across a year boundary', () => {
    expect(shiftMonth('2026-11', 3)).toBe('2027-02');
  });
});

describe('weeksInMonth', () => {
  it('clips the first partial week to the month start', () => {
    // 2026-08-01 is a Saturday -- the first bucket is just Sat + Sun.
    const weeks = weeksInMonth('2026-08');
    expect(weeks[0]).toEqual({ start: '2026-08-01', end: '2026-08-02' });
  });

  it('clips the last partial week to the month end', () => {
    const weeks = weeksInMonth('2026-08');
    expect(weeks.at(-1).end).toBe('2026-08-31');
  });

  it('agrees with weekly_spend on where a full-week bucket starts', () => {
    // The same date documented in budget-calc::transaction's own test --
    // this is the cross-language contract the two must never disagree on.
    expect(weeksInMonth('2026-08')[1]).toEqual({ start: '2026-08-03', end: '2026-08-09' });
  });

  it('covers every day of the month exactly once, in order', () => {
    const weeks = weeksInMonth('2026-02');
    const days = weeks.flatMap(({ start, end }) => {
      const out = [];
      let d = new Date(...start.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
      const last = new Date(...end.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
      while (d <= last) {
        out.push(todayIso(d));
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
      return out;
    });
    expect(days[0]).toBe('2026-02-01');
    expect(days.at(-1)).toBe('2026-02-28');
    expect(new Set(days).size).toBe(days.length);
    expect(days.length).toBe(28);
  });
});

describe('weekLabel', () => {
  it('formats a range as "Mon D–D"', () => {
    expect(weekLabel('2026-08-03', '2026-08-09', 'en')).toBe('Aug 3–Aug 9');
  });

  it('formats a single clipped day the same way, start and end equal', () => {
    expect(weekLabel('2026-08-01', '2026-08-01', 'en')).toBe('Aug 1–Aug 1');
  });
});
