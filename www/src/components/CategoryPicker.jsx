import React, { useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';
import NewCategoryField from './NewCategoryField';
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
 *
 * The last chip creates one. Until this existed, a category that didn't
 * fit anything on the list meant abandoning a half-typed transaction for
 * More's Categories screen and starting the entry again -- so the real
 * choice on offer was "file it somewhere wrong" or "lose the entry", and
 * the honest third option cost the most. The filter box doubles as the
 * name field for the same reason: somebody who has already typed
 * "Vet" and found nothing has said what they want. Opening that field
 * also surfaces the starter presets nobody's added yet, as one-tap chips
 * above the typed-name input (see `NewCategoryField`'s own comment) --
 * typing is the fallback for a name that isn't already one of them, not
 * the only way in.
 */
const CHIP_COUNT = 6;

export default function CategoryPicker({ ordered, value, onChange, isIncome, createCategory }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  // Null when closed; otherwise the name to open the field with, which is
  // '' from the "+ New" chip and the filter text when nothing matched it.
  const [creatingFrom, setCreatingFrom] = useState(null);

  // `createCategory` is `useCreateCategory`'s whole return value, not
  // just its `create` function -- this picker is the one place that
  // knows both which direction it's on and which preset list matches it.
  const unusedPresets = isIncome
    ? createCategory.availableIncomePresets
    : createCategory.availableExpensePresets;

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

  /** A category reached this way is always the person's own answer, never
   *  a suggestion -- they just named it. Closing everything afterwards
   *  puts the new chip back in a row they can see it selected in. */
  const onCreated = (id) => {
    onChange(id);
    setCreatingFrom(null);
    setFilter('');
    setShowAll(false);
  };

  const createField = (
    <NewCategoryField
      // Remounts when the seed changes, so opening the field from the
      // filter's "create this" button starts on that text rather than
      // whatever the field held last time.
      key={creatingFrom}
      initialName={creatingFrom ?? ''}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- this field only exists because the chip above it was just tapped; the caret belongs in it.
      autoFocus
      isIncome={isIncome}
      create={createCategory.create}
      presets={unusedPresets}
      onCreated={onCreated}
    />
  );

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

  const newChip = (
    <button
      type="button"
      className={`category-chip category-chip-new${creatingFrom !== null ? ' active' : ''}`}
      aria-expanded={creatingFrom !== null}
      onClick={() => setCreatingFrom(creatingFrom === null ? '' : null)}
    >
      {t('category.newChip')}
    </button>
  );

  // Nothing on this side of the ledger yet -- the one state where naming
  // a category is not just easier than the alternative, it is the only
  // thing to do here.
  if (ordered.length === 0) {
    return (
      <div className="category-picker">
        <span className="field-label">{t('transactions.category')}</span>
        <p className="field-label">{t('transactions.noCategoriesYet')}</p>
        <div className="category-chips">{newChip}</div>
        {creatingFrom !== null && createField}
      </div>
    );
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
        {newChip}
      </div>

      {creatingFrom !== null && createField}

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
            <>
              <p className="field-label">{t('transactions.noCategoryMatch')}</p>
              {/* Hidden while the field is already open, or this would
                  offer to create the filter text while the field above
                  showed a different, half-edited name. */}
              {creatingFrom === null && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setCreatingFrom(filter.trim())}
                >
                  {t('category.createNamed', { name: filter.trim() })}
                </button>
              )}
            </>
          ) : (
            <div className="category-chips">{filtered.map(chip)}</div>
          )}
        </div>
      )}
    </div>
  );
}
