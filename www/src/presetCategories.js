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
