/**
 * Which starter presets are still worth offering, given the categories
 * that already exist.
 *
 * `addCommonCategories` (seeds every not-yet-taken preset at once) and the
 * Budget tab's chip picker (offers the same not-yet-taken presets one tap
 * at a time) both need the identical "is this preset already taken" rule
 * -- pulled out here so there is one implementation instead of two that
 * could drift apart.
 *
 * A preset is taken by either of two independent checks, both required:
 *
 * 1. By identity: a preset whose `key` matches an existing category's
 *    `preset_key`. This matters because presets get renamed (their
 *    translated `name` text changes) -- an existing user's already-saved
 *    category still carries the OLD display name under the SAME
 *    `preset_key`, and without this check a renamed preset would be
 *    re-offered and inserted as a duplicate carrying the NEW name.
 * 2. By translated display name, case- and whitespace-insensitive: a
 *    hand-typed category has no `preset_key` at all (e.g. someone typed
 *    "Housing" by hand), so a preset that translates to the same name
 *    must still be treated as taken.
 *
 * Both checks are needed; neither replaces the other.
 *
 * Assumes `presets` itself contains no two entries sharing a `key` or a
 * translated name -- `taken`/`takenPresetKeys` below are computed once
 * from `existingCategories` and then held fixed while filtering, so
 * nothing here would catch a same-batch collision inside `presets`.
 * `crates/budget-calc/src/presets.rs`'s own tests
 * (`no_category_is_offered_twice`, `no_two_categories_share_a_display_name`)
 * guarantee this for the real starter list, so it's not defended against
 * here. The pre-refactor inline version in `App.jsx` happened to dedup
 * incrementally within one pass (each accepted preset was added to the
 * running sets before the next was checked), which would have masked
 * such a collision rather than surfacing it -- that incidental behavior
 * isn't reproduced here, on purpose, since adding runtime defenses for a
 * scenario the Rust test suite already forecloses would be exactly the
 * kind of unneeded complexity this repo tries to avoid.
 *
 * @param {Array<{key: string, group_key: string, is_income: boolean, parent_key: string|null}>} presets
 *   Presets as returned by `wasm.preset_categories()`.
 * @param {Array<{name: string, preset_key?: string}>} existingCategories
 *   The categories already saved.
 * @param {(key: string) => string} translate
 *   The reader's `t` function, used to resolve a preset's `key` and an
 *   existing category's stored name to the same comparable string.
 * @returns {Array} The subset of `presets` not yet taken, in their
 *   original order.
 */
export function availablePresets(presets, existingCategories, translate) {
  const takenNames = new Set(existingCategories.map((c) => c.name.trim().toLowerCase()));
  const takenPresetKeys = new Set(existingCategories.map((c) => c.preset_key).filter(Boolean));

  return presets.filter((preset) => {
    if (takenPresetKeys.has(preset.key)) return false;
    const fingerprint = translate(preset.key).trim().toLowerCase();
    return !takenNames.has(fingerprint);
  });
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
export function presetsToAdd(chosen, allPresets, existingCategories, translate) {
  const available = new Set(
    availablePresets(allPresets, existingCategories, translate).map((p) => p.key),
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
export async function savePresets(presets, existingCategories, save, translate, newId) {
  const groupIds = new Map(
    existingCategories.filter((c) => c.preset_key && !c.parent_id).map((c) => [c.preset_key, c.id]),
  );
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
