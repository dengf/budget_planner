import React, { useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';
import { categoryDisplayName } from '../presetCategories';

/**
 * Picking a category, as a row of chips instead of a dropdown.
 *
 * A `<select>` costs three interactions -- open, scroll, pick -- and on a
 * phone it hands the whole screen to a native picker listing every
 * category the person has ever made, in an order that has nothing to do
 * with what they reach for. Adding a transaction is the thing people do
 * most in this app, so that middle step is where the time goes.
 *
 * `ordered` arrives already ranked (see useCategoryRank.js): the right
 * side of the ledger, most-used first. The first six get a chip, which
 * is what fits two rows at 375px without shrinking the tap target below
 * 44px; the rest stay one tap away behind "All", where a type-to-filter
 * box handles a long tail that no amount of ranking would ever surface.
 *
 * Tapping the selected chip clears it. A category is genuinely optional
 * -- an uncategorized transaction is a real, honest record, and better
 * than a wrong one filed to get the sheet closed.
 */
const CHIP_COUNT = 6;

export default function CategoryPicker({ ordered, value, onChange }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');

  const pick = (id) => onChange(id === value ? '' : id);

  // The selected category is always on screen, even when it isn't in the
  // top six -- a chip row that hides what it has selected reads as
  // nothing being selected at all.
  const selected = ordered.find((c) => c.id === value);
  const chips = ordered.slice(0, CHIP_COUNT);
  if (selected && !chips.includes(selected)) chips[CHIP_COUNT - 1] = selected;

  const needle = filter.trim().toLowerCase();
  const filtered = needle
    ? ordered.filter((c) => categoryDisplayName(c, t).toLowerCase().includes(needle))
    : ordered;

  const chip = (c) => (
    <button
      key={c.id}
      type="button"
      className={`category-chip${c.id === value ? ' active' : ''}`}
      aria-pressed={c.id === value}
      onClick={() => pick(c.id)}
    >
      <CategoryBadge category={c} />
      <span className="category-chip-name">{categoryDisplayName(c, t)}</span>
    </button>
  );

  if (ordered.length === 0) {
    return <p className="field-label">{t('transactions.noCategoriesYet')}</p>;
  }

  return (
    <div className="category-picker">
      <span className="field-label">{t('transactions.category')}</span>
      <div className="category-chips">
        {chips.map(chip)}
        {ordered.length > CHIP_COUNT && (
          <button
            type="button"
            className={`category-chip category-chip-more${showAll ? ' active' : ''}`}
            aria-expanded={showAll}
            onClick={() => setShowAll((open) => !open)}
          >
            {t('transactions.allCategories')}
          </button>
        )}
      </div>

      {showAll && (
        <div className="category-picker-all">
          <div className="field-input">
            <input
              type="search"
              value={filter}
              placeholder={t('transactions.filterCategories')}
              aria-label={t('transactions.filterCategories')}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {filtered.length === 0 ? (
            <p className="field-label">{t('transactions.noCategoryMatch')}</p>
          ) : (
            <div className="category-chips">{filtered.map(chip)}</div>
          )}
        </div>
      )}
    </div>
  );
}
