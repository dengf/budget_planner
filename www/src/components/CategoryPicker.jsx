import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';
import NewCategoryField from './NewCategoryField';
import { categoryDisplayName, categoryTree } from '../presetCategories';

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
 *
 * Subcategories are a second, optional step. The chip row holds groups
 * only -- ranked by the first time the group *or any of its
 * subcategories* appears in `ordered`, so a group someone uses through
 * "Groceries" still ranks as used. Once a group is chosen, its own
 * subcategories appear beneath as "More specific (optional)" chips; the
 * group alone is already a complete answer, since the budget plans at
 * group level anyway. Tapping the selected subcategory steps back up to
 * its group rather than clearing everything. "All" still lists every
 * category, subcategories included, so the filter box finds "Fuel"
 * without knowing it lives under Transportation.
 */
const CHIP_COUNT = 6;

export default function CategoryPicker({ ordered, value, onChange, isIncome, createCategory }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  // Null when closed; otherwise the name to open the field with, which is
  // '' from the "+ New" chip and the filter text when nothing matched it.
  const [creatingFrom, setCreatingFrom] = useState(null);
  // Whether the "More specific" row's own "+ New" field is open -- a
  // subcategory of whichever group is selected.
  const [creatingSub, setCreatingSub] = useState(false);

  // `createCategory` is `useCreateCategory`'s whole return value, not
  // just its `create` function -- this picker is the one place that
  // knows both which direction it's on and which preset list matches it.
  const unusedPresets = isIncome
    ? createCategory.availableIncomePresets
    : createCategory.availableExpensePresets;

  const pick = (id) => onChange(id === value ? '' : id);

  const tree = categoryTree(ordered);
  const topIds = new Set(tree.tops.map((c) => c.id));
  const byId = new Map(ordered.map((c) => [c.id, c]));
  const rootOf = (c) => (topIds.has(c.id) ? c : byId.get(c.parent_id));
  // Groups in the order they, or any of their subcategories, first rank.
  const groups = [];
  for (const c of ordered) {
    const root = rootOf(c);
    if (root && !groups.includes(root)) groups.push(root);
  }

  // The selected category's group is always on screen, even when it isn't
  // in the top six -- a chip row that hides what it has selected reads as
  // nothing being selected at all.
  const selected = byId.get(value);
  const selectedGroup = selected ? rootOf(selected) : null;
  const chips = groups.slice(0, CHIP_COUNT);
  if (selectedGroup && !chips.includes(selectedGroup)) chips[CHIP_COUNT - 1] = selectedGroup;
  const subChips = selectedGroup ? tree.childrenOf(selectedGroup.id) : [];
  const subPresets = selectedGroup
    ? (createCategory.availableSubPresets?.(selectedGroup) ?? [])
    : [];
  const subsRef = useRef(null);
  const subsFor = subChips.length > 0 ? selectedGroup.id : null;

  // The subcategory row appears below the chips, which in the add sheet
  // is often under its sticky submit bar -- options that appear out of
  // sight might as well not exist. Brought to the middle of the scroll
  // when a group with subcategories is chosen, the same way
  // NewCategoryField brings itself into view; only on a change of group,
  // so tapping between its subcategories doesn't keep yanking the sheet.
  useEffect(() => {
    if (!subsFor || !subsRef.current) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    subsRef.current.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [subsFor]);

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
    setCreatingSub(false);
    setFilter('');
    setShowAll(false);
  };

  const createField = (
    <NewCategoryField
      // Remounts when the seed changes, so opening the field from the
      // filter's "create this" button starts on that text rather than
      // whatever the field held last time -- and also once the preset
      // fetch settles, so a field that had to mount before knowing
      // whether presets exist gets a fresh, correct autoFocus decision
      // instead of being stuck with whatever it guessed at mount.
      key={`${creatingFrom}-${createCategory.presetsReady}`}
      initialName={creatingFrom ?? ''}
      // Stealing the keyboard the moment "+ New" is tapped defeats the
      // point of showing presets at all -- the chips get shoved behind
      // the keyboard before anyone's had a chance to read them. Autofocus
      // only when there's nothing to tap instead (`unusedPresets` is
      // empty, typing is the only path) or the keyboard is already up
      // because `creatingFrom` came from the filter box's own "Create X"
      // button -- there, focus doesn't summon anything new. `presetsReady`
      // guards the first case: the preset fetch is async even when it
      // resolves instantly, so trusting an empty list before it flips true
      // would autofocus on every open and then never let go once the real
      // presets arrive, since focus isn't revisited after mount.
      // eslint-disable-next-line jsx-a11y/no-autofocus -- conditional per the comment above; the caret belongs in the field exactly when nothing else does.
      autoFocus={
        Boolean(creatingFrom) || (createCategory.presetsReady && unusedPresets.length === 0)
      }
      isIncome={isIncome}
      create={createCategory.create}
      presets={unusedPresets}
      onCreated={onCreated}
    />
  );

  const chip = (c, active = c.id === value, onClick = () => pick(c.id)) => (
    <button
      key={c.id}
      type="button"
      className={`category-chip${active ? ' active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
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
      onClick={() => {
        setCreatingFrom(creatingFrom === null ? '' : null);
        setCreatingSub(false);
      }}
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
        {chips.map((c) =>
          // A group reads as chosen while one of its subcategories is.
          chip(c, c === selectedGroup, () => onChange(c.id === value ? '' : c.id)),
        )}
        {ordered.length > chips.length && (
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

      {/* Shown for any chosen group, even one with no subcategories yet:
          its "+ New" is how the first one gets made without leaving the
          sheet. The top row's "+ New" still makes a category of its own. */}
      {selectedGroup && (
        <div className="category-picker-subs" ref={subsRef}>
          <span className="field-label">{t('category.narrowDown')}</span>
          <div className="category-chips">
            {subChips.map((sub) =>
              chip(sub, sub.id === value, () =>
                onChange(sub.id === value ? selectedGroup.id : sub.id),
              ),
            )}
            <button
              type="button"
              className={`category-chip category-chip-new${creatingSub ? ' active' : ''}`}
              aria-expanded={creatingSub}
              aria-label={t('category.newSubIn', {
                name: categoryDisplayName(selectedGroup, t),
              })}
              onClick={() => {
                setCreatingSub((open) => !open);
                setCreatingFrom(null);
              }}
            >
              {t('category.newChip')}
            </button>
          </div>
          {creatingSub && (
            <NewCategoryField
              key={`${selectedGroup.id}-${createCategory.presetsReady}`}
              isIncome={isIncome}
              parentId={selectedGroup.id}
              create={createCategory.create}
              presets={subPresets}
              onCreated={onCreated}
              // Same rule as the top-level field: the caret only when
              // there is no preset chip to tap instead.
              // eslint-disable-next-line jsx-a11y/no-autofocus -- conditional; the caret belongs in the field exactly when nothing else does.
              autoFocus={createCategory.presetsReady && subPresets.length === 0}
            />
          )}
        </div>
      )}

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
            <div className="category-chips">{filtered.map((c) => chip(c))}</div>
          )}
        </div>
      )}
    </div>
  );
}
