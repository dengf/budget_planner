import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, categoryColor, categoryIconId } from './categoryVisuals';

describe('categoryVisuals', () => {
  it('keeps every original 14 presets at their original color index', () => {
    // Locks the historical order in place -- categoryVisuals.js's own doc
    // comment says a preset's position here is its PERMANENT color slot
    // for every installation that already exists. This test exists so a
    // future edit that reorders PRESET_KEY_ORDER (e.g. to "tidy" it into
    // presets.rs's declaration order) fails loudly instead of silently
    // recoloring everyone's existing Housing/Utilities/etc. categories.
    const original14 = [
      'cat.primaryEarnedIncome',
      'cat.selfEmploymentBusiness',
      'cat.investmentCapitalIncome',
      'cat.governmentSupplemental',
      'cat.otherIncome',
      'cat.housing',
      'cat.utilities',
      'cat.foodGroceries',
      'cat.transportation',
      'cat.healthcareInsurance',
      'cat.debtServicing',
      'cat.personalLifestyle',
      'cat.familyDependents',
      'cat.otherExpenses',
    ];
    original14.forEach((key, index) => {
      const expectedColor = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
      expect(categoryColor({ preset_key: key })).toBe(expectedColor);
    });
  });

  it('gives the two new presets their own icon id', () => {
    expect(categoryIconId({ preset_key: 'cat.subscriptionsMemberships' })).toBe('repeat');
    expect(categoryIconId({ preset_key: 'cat.giftsDonations' })).toBe('gift');
  });

  it('gives the two new presets a color from the shared palette, not the hash fallback', () => {
    // A known preset_key always resolves through PRESET_KEY_ORDER, never
    // categoryColor's djb2-hash fallback (that path is only for a
    // hand-typed category with no preset_key at all).
    expect(CATEGORY_PALETTE).toContain(categoryColor({ preset_key: 'cat.subscriptionsMemberships' }));
    expect(CATEGORY_PALETTE).toContain(categoryColor({ preset_key: 'cat.giftsDonations' }));
  });
});
