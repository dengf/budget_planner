import React from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';

function ChipGroup({ label, presets, onAdd }) {
  const { t } = useI18n();
  if (presets.length === 0) return null;
  return (
    <div className="category-chip-group">
      <div className="category-chip-group-label">{label}</div>
      <div className="category-chip-row">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className="category-chip"
            onClick={() => onAdd(preset)}
          >
            <CategoryBadge category={{ preset_key: preset.key, is_income: preset.is_income }} />
            {t(preset.key)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One tap, one category -- offered as a row of chips rather than
 * `addCommonCategories`'s all-16-at-once button, so a first-time budget
 * can start with the three or four presets someone actually recognizes
 * instead of every starter category landing on the page unasked (the
 * Goodbudget-sourced finding in the design spec: don't front-load more
 * decisions than necessary).
 *
 * Split into an Income group and an Expense group, same section labels
 * as the category table below (`cat.group.income`/`cat.group.expense`)
 * -- the assign banner's very first message tells someone to start with
 * income, but a flat 16-chip grid gave no way to tell which chips those
 * were. Grouping is display-only: `budget-calc/src/presets.rs`'s own
 * flat, ungrouped preset list (and its name-based dedup) is unchanged,
 * this only sorts what's already there into two visual rows.
 *
 * `presets` is expected to already be filtered to "not yet added" -- see
 * `availablePresets` in `presetCategories.js`. This component only
 * renders whatever list it's handed and reports which one was tapped;
 * it doesn't know or care what's already been added.
 */
export default function CategoryChipPicker({ presets, onAdd }) {
  const { t } = useI18n();
  if (presets.length === 0) return null;
  const income = presets.filter((p) => p.is_income);
  const expense = presets.filter((p) => !p.is_income);
  return (
    <div className="category-chip-picker">
      <ChipGroup label={t('cat.group.income')} presets={income} onAdd={onAdd} />
      <ChipGroup label={t('cat.group.expense')} presets={expense} onAdd={onAdd} />
    </div>
  );
}
