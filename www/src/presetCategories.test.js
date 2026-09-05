import { describe, expect, it } from 'vitest';
import { availablePresets } from './presetCategories';

const HOUSING = { key: 'cat.housing' };
const UTILITIES = { key: 'cat.utilities' };
const NAMES = { 'cat.housing': 'Housing', 'cat.utilities': 'Utilities' };
const translate = (key) => NAMES[key];

describe('availablePresets', () => {
  it('offers every preset when nothing exists yet', () => {
    expect(availablePresets([HOUSING, UTILITIES], [], translate)).toEqual([
      HOUSING,
      UTILITIES,
    ]);
  });

  it('excludes a preset whose translated name is already a category, case- and whitespace-insensitive', () => {
    const existing = [{ id: 'c1', name: ' housing ' }];
    expect(availablePresets([HOUSING, UTILITIES], existing, translate)).toEqual([UTILITIES]);
  });

  it('excludes a preset taken by a hand-typed category with the exact same name', () => {
    const existing = [{ id: 'c1', name: 'Housing' }];
    expect(availablePresets([HOUSING, UTILITIES], existing, translate)).toEqual([UTILITIES]);
  });

  it('excludes a preset by preset_key identity even when the stored name no longer matches the current translated name', () => {
    // Simulates a renamed preset: the existing category was saved under
    // the old display name, but still carries the same preset_key.
    const existing = [{ id: 'c1', name: 'Old Housing Name', preset_key: 'cat.housing' }];
    expect(availablePresets([HOUSING, UTILITIES], existing, translate)).toEqual([UTILITIES]);
  });

  it('returns an empty list once every preset is taken (mix of both dedup paths)', () => {
    const existing = [
      { id: 'c1', name: 'Old Housing Name', preset_key: 'cat.housing' },
      { id: 'c2', name: ' Utilities ' },
    ];
    expect(availablePresets([HOUSING, UTILITIES], existing, translate)).toEqual([]);
  });
});
