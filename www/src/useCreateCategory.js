import { useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { buildCategoryFromPreset, categoryDisplayName } from './presetCategories';

/**
 * Creating a category from wherever somebody happens to need one -- the
 * picker inside the add sheet, or the Budget tab -- instead of sending
 * them to More's Categories screen and back.
 *
 * What to actually do with a typed name is `budget_calc::resolve_category_name`,
 * not this hook: the same word can mean "you already have that one",
 * "that's a starter preset, take the furnished version", "that's your
 * *income* category and you're logging an expense" or "that's new", and
 * each saves a different record or none at all. This holds the call, the
 * preset list it needs, and the one save that follows.
 *
 * Both name lists are resolved into the reader's current language before
 * they cross the boundary -- `categoryDisplayName` for saved categories
 * (a preset-derived one re-translates live, so its stored text can be a
 * language behind the screen) and `t(preset.key)` for presets, which
 * cross as i18n keys by convention. Somebody types what they can see.
 *
 * Returns `{ outcome, categoryId }`. `outcome` is the Rust case verbatim;
 * `categoryId` is what to select afterwards, present for every case
 * except `blank` and `error` -- including `other_direction`, where it
 * points at the category that clashed so the caller can name it.
 */
export function useCreateCategory({ wasmModule, categories, newId }) {
  const { t } = useI18n();
  const [presets, setPresets] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wasmModule?.preset_categories) return;
      const loaded = (await wasmModule.preset_categories()) ?? [];
      if (!cancelled) setPresets(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [wasmModule]);

  return useCallback(
    async (typed, isIncome) => {
      if (!wasmModule?.resolve_category_name) return { outcome: 'error' };

      const resolved = await wasmModule.resolve_category_name({
        typed,
        direction: isIncome ? 'income' : 'expense',
        existing: categories.items.map((c) => ({
          id: c.id,
          name: categoryDisplayName(c, t),
          is_income: Boolean(c.is_income),
        })),
        presets: presets.map((p) => ({
          key: p.key,
          name: t(p.key),
          is_income: p.is_income,
        })),
      });
      if (resolved?.error) return { outcome: 'error' };

      switch (resolved.outcome) {
        case 'existing':
        case 'other_direction':
          return { outcome: resolved.outcome, categoryId: resolved.category_id };
        case 'preset': {
          // Saved through the same builder the chip picker and the
          // starter seed use, so a category reached this way is
          // indistinguishable from one added on the Categories screen --
          // icon, group, description and the `preset_key` that keeps it
          // re-translating all included.
          const preset = presets.find((p) => p.key === resolved.preset_key);
          const record = buildCategoryFromPreset(preset, t, newId);
          await categories.save(record);
          return { outcome: 'preset', categoryId: record.id };
        }
        case 'create': {
          const record = {
            id: newId(),
            name: resolved.name,
            group: t(resolved.group_key),
            is_income: Boolean(isIncome),
            description: '',
          };
          await categories.save(record);
          return { outcome: 'create', categoryId: record.id };
        }
        default:
          return { outcome: 'blank' };
      }
    },
    [wasmModule, categories, newId, presets, t],
  );
}
