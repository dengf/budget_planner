import { describe, expect, it } from 'vitest';
import { ASSIGN, TRACKING, budgetMode } from './budgetMode';

describe('budgetMode', () => {
  it('is assign mode before any income exists', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: false, unassigned: 0 })).toBe(ASSIGN);
  });

  it('is assign mode while income is still unassigned', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: true, unassigned: 300 })).toBe(ASSIGN);
  });

  it('is assign mode when over-assigned -- there is still a decision to make', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: true, unassigned: -50 })).toBe(ASSIGN);
  });

  it('is tracking mode once fully assigned', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: true, unassigned: 0 })).toBe(TRACKING);
  });

  it('is always tracking mode for a past month, even if never fully assigned', () => {
    expect(budgetMode({ isPastMonth: true, hasIncome: true, unassigned: 300 })).toBe(TRACKING);
  });

  it('is tracking mode for a past month even with no income at all', () => {
    expect(budgetMode({ isPastMonth: true, hasIncome: false, unassigned: 0 })).toBe(TRACKING);
  });
});
