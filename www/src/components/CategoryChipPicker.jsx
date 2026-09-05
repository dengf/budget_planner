import React from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';

/**
 * One tap, one category -- offered as a row of chips rather than
 * `addCommonCategories`'s all-16-at-once button, so a first-time budget
 * can start with the three or four presets someone actually recognizes
 * instead of every starter category landing on the page unasked (the
 * Goodbudget-sourced finding in the design spec: don't front-load more
 * decisions than necessary).
 *
 * `presets` is expected to already be filtered to "not yet added" -- see
 * `availablePresets` in `presetCategories.js`. This component only
 * renders whatever list it's handed and reports which one was tapped;
 * it doesn't know or care what's already been added.
 */
export default function CategoryChipPicker({ presets, onAdd }) {
  const { t } = useI18n();
  if (presets.length === 0) return null;
  return (
    <div className="category-chip-picker">
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
  );
}
