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
 * @param {Array<{key: string, group_key: string, description_key: string, is_income: boolean}>} presets
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
 * Builds the category record `addCommonCategories` and `addPresetCategory`
 * both save for one preset -- pulled out so the two call sites (seed the
 * whole starter set at once, versus add one preset per chip tap) share
 * one object shape instead of repeating the same six fields twice.
 *
 * @param {{key: string, group_key: string, description_key: string, is_income: boolean}} preset
 * @param {(key: string) => string} translate The reader's `t` function.
 * @param {() => string} newId Generates the new category's id.
 * @returns {{id: string, name: string, group: string, is_income: boolean, description: string, preset_key: string}}
 */
export function buildCategoryFromPreset(preset, translate, newId) {
  return {
    id: newId(),
    name: translate(preset.key),
    group: translate(preset.group_key),
    is_income: preset.is_income,
    description: translate(preset.description_key),
    preset_key: preset.key,
  };
}
