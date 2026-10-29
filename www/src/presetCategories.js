/**
 * The budget's categories as the Rust preset checks read them, each under
 * the name the reader sees (`categoryDisplayName`), which is what a typed
 * name or a preset's translated name gets compared against.
 */
export function categoryNodes(categories, translate) {
  return categories.map((c) => ({
    id: c.id,
    name: categoryDisplayName(c, translate),
    group: c.group ?? '',
    is_income: Boolean(c.is_income),
    preset_key: c.preset_key ?? null,
    parent_id: c.parent_id ?? null,
    subcategories_filled: Boolean(c.subcategories_filled),
  }));
}

/**
 * Presets with their names resolved into the reader's language -- preset
 * names cross the wasm boundary as i18n keys, so only this side can say
 * what one reads as.
 */
export function namedPresets(presets, translate) {
  return presets.map((p) => ({
    key: p.key,
    name: translate(p.key),
    is_income: Boolean(p.is_income),
  }));
}

/**
 * Which starter presets are still worth offering, given the categories
 * that already exist -- `budget_calc::available_presets`, which owns the
 * rule (taken by `preset_key`, or by a category already carrying the
 * preset's name). `addCommonCategories`, the first-run seed, the chip
 * pickers and `presetsToAdd` all ask it, so none of them can drift from
 * the others.
 *
 * Returns the subset of `presets` not yet taken, in their original order,
 * or nothing while the wasm module isn't there to ask.
 */
export function availablePresets(wasm, presets, existingCategories, translate) {
  if (!wasm?.available_presets || presets.length === 0) return [];
  const result = wasm.available_presets({
    categories: categoryNodes(existingCategories, translate),
    presets: namedPresets(presets, translate),
  });
  const keys = new Set(result?.keys ?? []);
  return presets.filter((preset) => keys.has(preset.key));
}

/**
 * Builds the category record every preset-adding path saves -- pulled out
 * so seeding, the chip picker and a typed name that turns out to be a
 * preset share one object shape.
 *
 * `parentId` is the saved id of the preset's group, for a subcategory;
 * `addPresets` below is what looks it up, so callers rarely pass it.
 *
 * @param {{key: string, group_key: string, is_income: boolean, parent_key?: string|null}} preset
 * @param {(key: string) => string} translate The reader's `t` function.
 * @param {() => string} newId Generates the new category's id.
 * @param {string|null} [parentId]
 */
export function buildCategoryFromPreset(preset, translate, newId, parentId = null) {
  return {
    id: newId(),
    name: translate(preset.key),
    group: translate(preset.group_key),
    is_income: preset.is_income,
    description: '',
    preset_key: preset.key,
    parent_id: parentId,
    // A group is only ever added along with its subcategories
    // (`presetsToAdd`), so it never needs the fill.
    subcategories_filled: !preset.parent_key,
  };
}

/**
 * Everything adding `chosen` should actually save, in save order.
 *
 * The CPA's list is two levels deep, and either half on its own is a
 * wrong record: a group added without its subcategories arrives as a
 * bare bucket with none of the detail the list exists for, and a
 * subcategory added without its group has nowhere to roll up to. So a
 * group brings its not-yet-taken subcategories, and a subcategory brings
 * its group if the budget doesn't have it yet. Anything already taken
 * (`availablePresets`' rule) is skipped.
 */
export function presetsToAdd(wasm, chosen, allPresets, existingCategories, translate) {
  const available = new Set(
    availablePresets(wasm, allPresets, existingCategories, translate).map((p) => p.key),
  );
  const out = [];
  const push = (preset) => {
    if (preset && available.has(preset.key) && !out.includes(preset)) out.push(preset);
  };
  for (const preset of chosen) {
    if (preset.parent_key) {
      push(allPresets.find((p) => p.key === preset.parent_key));
      push(preset);
    } else {
      push(preset);
      allPresets.filter((p) => p.parent_key === preset.key).forEach(push);
    }
  }
  return out;
}

/**
 * Saves presets (already expanded by `presetsToAdd`, or a caller's own
 * ordered list with every group before its subcategories) and files each
 * subcategory under its group -- the budget's existing copy of that group
 * if it has one, else the one saved a moment earlier in this same call.
 * Sequential rather than `Promise.all`: each save is one IndexedDB write,
 * and the list reads better in declaration order.
 *
 * Resolves to the saved records, in order.
 */
export async function savePresets(wasm, presets, existingCategories, save, translate, newId) {
  // Which saved category each group is -- `budget_calc::preset_group_ids`:
  // the one saved from that preset, else a hand-typed one that reads as
  // it (which `availablePresets` already counts as that preset, so it is
  // never offered again).
  const parents = [...new Set(presets.map((p) => p.parent_key).filter(Boolean))].map((key) => ({
    key,
    is_income: presets.find((p) => p.parent_key === key).is_income,
  }));
  const groupIds = new Map();
  if (parents.length > 0 && wasm?.preset_group_ids) {
    const result = wasm.preset_group_ids({
      categories: categoryNodes(existingCategories, translate),
      presets: namedPresets(parents, translate),
    });
    for (const { key, id } of result?.groups ?? []) groupIds.set(key, id);
  }
  const saved = [];
  for (const preset of presets) {
    const parentId = preset.parent_key ? (groupIds.get(preset.parent_key) ?? null) : null;
    const record = buildCategoryFromPreset(preset, translate, newId, parentId);
    await save(record);
    if (!preset.parent_key) groupIds.set(preset.key, record.id);
    saved.push(record);
  }
  return saved;
}

/**
 * The top-level categories, and which of the rest belong under each --
 * the shape every screen that lists categories as groups needs.
 *
 * A subcategory whose parent is missing is listed as top-level, the same
 * reading `budget_calc::parent_map` gives it, so it can never disappear
 * from a list while its money still counts somewhere.
 */
export function categoryTree(categories) {
  const ids = new Set(categories.map((c) => c.id));
  const isSub = (c) => c.parent_id && c.parent_id !== c.id && ids.has(c.parent_id);
  const tops = categories.filter((c) => !isSub(c));
  const children = new Map(tops.map((c) => [c.id, []]));
  for (const c of categories) {
    if (isSub(c)) children.get(c.parent_id)?.push(c);
  }
  return { tops, childrenOf: (id) => children.get(id) ?? [] };
}

/** The id a category's figures roll up into: its parent's, or its own. */
export function rootIdOf(categories, id) {
  const category = categories.find((c) => c.id === id);
  const parent = category?.parent_id && categories.find((c) => c.id === category.parent_id);
  return parent ? parent.id : id;
}

/**
 * The name/description/group to show for a category, live in the
 * reader's *current* language -- as opposed to `category.name` etc.
 * themselves, which are translated once and frozen into storage at
 * creation time (see `buildCategoryFromPreset` above). Left alone, that
 * freezing means switching the UI language after the fact leaves Chinese
 * chrome around English starter-category text.
 *
 * A preset-derived category's `preset_key` is stable and doubles as the
 * exact i18n key (`categoryVisuals.js` already relies on this same fact
 * for icon/color), so it can always be re-translated live instead of
 * trusting the frozen fields. A hand-typed category has no `preset_key`
 * to look anything up by -- there, the stored text *is* the only text,
 * so these fall back to it unchanged.
 */
export function categoryDisplayName(category, t) {
  if (!category) return '';
  // A key the catalogs don't know -- a category from an older starter
  // list in the moment before `migrate_legacy_categories` moves it, or
  // one restored from a newer app's export -- keeps its stored name
  // rather than showing the raw key.
  const live = category.preset_key ? t(category.preset_key) : null;
  return live && live !== category.preset_key ? live : (category.name ?? '');
}

/**
 * The standing hint shown beside a category. Starter categories used to
 * carry a one-line description each; the CPA's grouped list says the same
 * thing with subcategories instead, so a group's hint is now the names
 * of what's filed under it. A hand-typed category keeps whatever
 * description it was saved with.
 */
export function categoryDisplayDescription(category, t, categories = []) {
  if (!category) return '';
  const subs = categories.filter((c) => c.parent_id === category.id);
  if (subs.length > 0) return subs.map((c) => categoryDisplayName(c, t)).join(', ');
  return category.preset_key ? '' : (category.description ?? '');
}

export function categoryDisplayGroup(category, t) {
  if (!category) return '';
  return category.preset_key
    ? t(category.is_income ? 'cat.group.income' : 'cat.group.expense')
    : (category.group ?? '');
}

/**
 * Look a category up by the id a transaction, rule or recurring item
 * stores, and name it -- including the one case `categoryDisplayName`
 * alone can't answer: an id that matches nothing (or none at all), which
 * has to read as "Uncategorized" rather than an empty cell.
 *
 * Lives here rather than in each tab because three screens now render a
 * category next to a stored id -- Transactions' list, and the rules and
 * recurring tables that moved to More -- and three private copies of the
 * same four lines is exactly how one of them ends up saying something
 * different from the other two.
 */
export function makeCategoryLookup(categories, t) {
  const find = (id) => categories.find((c) => c.id === id);
  return {
    categoryFor: find,
    categoryName: (id) => {
      const category = find(id);
      return category ? categoryDisplayName(category, t) : t('transactions.uncategorized');
    },
  };
}

const SUBCATEGORIES_FILLED_KEY = 'bp:subcategoriesFilled';

/**
 * Whether this browser ran the first, per-browser version of the
 * subcategory fill (#134). That version kept its "done" flag here; the
 * fill now marks each group record instead (`subcategories_filled`). A
 * budget with this flag set already had its fill, so its groups are
 * marked without filling again -- filling would bring back subcategories
 * the reader deleted since.
 */
export function legacySubcategoriesFilled() {
  try {
    return localStorage.getItem(SUBCATEGORIES_FILLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearLegacySubcategoriesFilled() {
  try {
    localStorage.removeItem(SUBCATEGORIES_FILLED_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
