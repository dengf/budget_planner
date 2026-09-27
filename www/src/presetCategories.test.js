import { describe, expect, it } from 'vitest';
import {
  availablePresets,
  buildCategoryFromPreset,
  categoryTree,
  presetsToAdd,
  rootIdOf,
  savePresets,
} from './presetCategories';

const HOUSING = { key: 'cat.housing' };
const UTILITIES = { key: 'cat.utilities' };
const NAMES = { 'cat.housing': 'Housing', 'cat.utilities': 'Utilities' };
const translate = (key) => NAMES[key];

describe('availablePresets', () => {
  it('offers every preset when nothing exists yet', () => {
    expect(availablePresets([HOUSING, UTILITIES], [], translate)).toEqual([HOUSING, UTILITIES]);
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

describe('buildCategoryFromPreset', () => {
  it('builds the saved category shape from a preset, translated', () => {
    const newId = () => 'new-id';
    const preset = {
      key: 'cat.housingUtilities',
      group_key: 'group.expenses',
      is_income: false,
      parent_key: null,
    };
    const t = (key) =>
      ({
        'cat.housingUtilities': 'Housing & Utilities',
        'group.expenses': 'Expenses',
      })[key];

    expect(buildCategoryFromPreset(preset, t, newId)).toEqual({
      id: 'new-id',
      name: 'Housing & Utilities',
      group: 'Expenses',
      is_income: false,
      description: '',
      preset_key: 'cat.housingUtilities',
      parent_id: null,
    });
  });
});

const FOOD = { key: 'cat.foodBasics', parent_key: null, is_income: false };
const GROCERIES = { key: 'cat.groceries', parent_key: 'cat.foodBasics', is_income: false };
const CARE = { key: 'cat.personalCareEssentials', parent_key: 'cat.foodBasics', is_income: false };
const TREE = [FOOD, GROCERIES, CARE];
const TREE_NAMES = {
  'cat.foodBasics': 'Food & Basic Goods',
  'cat.groceries': 'Groceries',
  'cat.personalCareEssentials': 'Personal Care Essentials',
};
const tTree = (key) => TREE_NAMES[key];

describe('presetsToAdd', () => {
  it('brings a group’s subcategories along with it', () => {
    expect(presetsToAdd([FOOD], TREE, [], tTree)).toEqual([FOOD, GROCERIES, CARE]);
  });

  it('brings a subcategory’s group first when the budget lacks it', () => {
    expect(presetsToAdd([GROCERIES], TREE, [], tTree)).toEqual([FOOD, GROCERIES]);
  });

  it('skips anything already in the budget', () => {
    const existing = [{ id: 'g', name: 'Food & Basic Goods', preset_key: 'cat.foodBasics' }];
    expect(presetsToAdd([GROCERIES], TREE, existing, tTree)).toEqual([GROCERIES]);
    expect(presetsToAdd([FOOD], TREE, existing, tTree)).toEqual([GROCERIES, CARE]);
  });
});

describe('savePresets', () => {
  it('files each subcategory under the group saved just before it', async () => {
    let n = 0;
    const saved = await savePresets(
      [FOOD, GROCERIES],
      [],
      async () => {},
      tTree,
      () => `id-${++n}`,
    );
    expect(saved.map((r) => [r.id, r.parent_id])).toEqual([
      ['id-1', null],
      ['id-2', 'id-1'],
    ]);
  });

  it('files a subcategory under the budget’s existing copy of its group', async () => {
    const existing = [{ id: 'old-food', preset_key: 'cat.foodBasics', parent_id: null }];
    const saved = await savePresets(
      [CARE],
      existing,
      async () => {},
      tTree,
      () => 'new',
    );
    expect(saved[0].parent_id).toBe('old-food');
  });
});

describe('categoryTree and rootIdOf', () => {
  const categories = [
    { id: 'food' },
    { id: 'groceries', parent_id: 'food' },
    { id: 'orphan', parent_id: 'deleted' },
    { id: 'self', parent_id: 'self' },
  ];

  it('lists groups on top, subcategories under them, and an orphan as a group', () => {
    const tree = categoryTree(categories);
    expect(tree.tops.map((c) => c.id)).toEqual(['food', 'orphan', 'self']);
    expect(tree.childrenOf('food').map((c) => c.id)).toEqual(['groceries']);
    expect(tree.childrenOf('orphan')).toEqual([]);
  });

  it('rolls a subcategory up to its group and leaves the rest alone', () => {
    expect(rootIdOf(categories, 'groceries')).toBe('food');
    expect(rootIdOf(categories, 'food')).toBe('food');
    expect(rootIdOf(categories, 'orphan')).toBe('orphan');
  });
});
