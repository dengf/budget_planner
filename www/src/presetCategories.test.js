import { describe, expect, it } from 'vitest';
import {
  availablePresets,
  buildCategoryFromPreset,
  categoryTree,
  presetsToAdd,
  rootIdOf,
  savePresets,
} from './presetCategories';

// The taken-or-not rule itself is `budget_calc::available_presets` and
// `preset_group_ids`, tested in Rust. These stand in for the bindings and
// check only what crosses the boundary and what comes back.
function stubPresetWasm({ available, groups = [] } = {}) {
  const calls = { available: [], groups: [] };
  return {
    calls,
    available_presets: (params) => {
      calls.available.push(params);
      const keys = available ?? params.presets.map((p) => p.key);
      return { keys, error: null };
    },
    preset_group_ids: (params) => {
      calls.groups.push(params);
      return { groups, error: null };
    },
  };
}

const HOUSING = { key: 'cat.housing', is_income: false };
const UTILITIES = { key: 'cat.utilities', is_income: false };
const NAMES = { 'cat.housing': 'Housing', 'cat.utilities': 'Utilities' };
const translate = (key) => NAMES[key] ?? key;

describe('availablePresets', () => {
  it('keeps the presets Rust says are free, in their own order', () => {
    const wasm = stubPresetWasm({ available: ['cat.utilities'] });
    expect(availablePresets(wasm, [HOUSING, UTILITIES], [], translate)).toEqual([UTILITIES]);
  });

  it('sends each preset under its translated name, and each category under the name the reader sees', () => {
    const wasm = stubPresetWasm();
    const existing = [
      { id: 'c1', name: 'Old Housing Name', preset_key: 'cat.housing', group: 'Expense' },
      { id: 'c2', name: 'Mine', parent_id: 'c1' },
    ];
    availablePresets(wasm, [HOUSING, UTILITIES], existing, translate);
    const [params] = wasm.calls.available;
    expect(params.presets).toEqual([
      { key: 'cat.housing', name: 'Housing', is_income: false },
      { key: 'cat.utilities', name: 'Utilities', is_income: false },
    ]);
    expect(params.categories.map((c) => [c.id, c.name, c.preset_key, c.parent_id])).toEqual([
      ['c1', 'Housing', 'cat.housing', null],
      ['c2', 'Mine', null, 'c1'],
    ]);
  });

  it('offers nothing while there is no wasm module to ask', () => {
    expect(availablePresets(null, [HOUSING], [], translate)).toEqual([]);
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
      subcategories_filled: true,
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
    expect(presetsToAdd(stubPresetWasm(), [FOOD], TREE, [], tTree)).toEqual([
      FOOD,
      GROCERIES,
      CARE,
    ]);
  });

  it('brings a subcategory’s group first when the budget lacks it', () => {
    expect(presetsToAdd(stubPresetWasm(), [GROCERIES], TREE, [], tTree)).toEqual([FOOD, GROCERIES]);
  });

  it('skips anything Rust says the budget already has', () => {
    const wasm = stubPresetWasm({ available: ['cat.groceries', 'cat.personalCareEssentials'] });
    expect(presetsToAdd(wasm, [GROCERIES], TREE, [], tTree)).toEqual([GROCERIES]);
    expect(presetsToAdd(wasm, [FOOD], TREE, [], tTree)).toEqual([GROCERIES, CARE]);
  });
});

describe('savePresets', () => {
  it('files each subcategory under the group saved just before it', async () => {
    let n = 0;
    const saved = await savePresets(
      stubPresetWasm(),
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

  it('files a subcategory under the group Rust finds in the budget', async () => {
    const wasm = stubPresetWasm({ groups: [{ key: 'cat.foodBasics', id: 'typed' }] });
    const existing = [{ id: 'typed', name: 'food & basic goods', parent_id: null }];
    const saved = await savePresets(
      wasm,
      [GROCERIES, CARE],
      existing,
      async () => {},
      tTree,
      () => 'new',
    );
    expect(saved.map((r) => r.parent_id)).toEqual(['typed', 'typed']);
    // Asked once, about the one group, under its translated name.
    expect(wasm.calls.groups).toHaveLength(1);
    expect(wasm.calls.groups[0].presets).toEqual([
      { key: 'cat.foodBasics', name: 'Food & Basic Goods', is_income: false },
    ]);
  });

  it('leaves a subcategory top-level when Rust finds no group for it', async () => {
    const saved = await savePresets(
      stubPresetWasm(),
      [GROCERIES],
      [],
      async () => {},
      tTree,
      () => 'new',
    );
    expect(saved[0].parent_id).toBeNull();
  });

  it('marks a group as already having its subcategories, and a subcategory not', async () => {
    let n = 0;
    const saved = await savePresets(
      stubPresetWasm(),
      [FOOD, GROCERIES],
      [],
      async () => {},
      tTree,
      () => `id-${++n}`,
    );
    expect(saved.map((r) => r.subcategories_filled)).toEqual([true, false]);
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
