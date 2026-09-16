import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';

/**
 * The name field behind every "add a category" affordance outside the
 * Categories screen: one in the add sheet's picker, one at the foot of
 * each of Budget's two sections.
 *
 * Shared rather than written twice because the interesting part isn't the
 * input, it's what comes back from `create` -- four outcomes, one of which
 * (`other_direction`) is a message rather than a saved category. Two
 * copies of that handling is how one screen starts quietly creating the
 * duplicate the other refuses.
 *
 * `presets` -- the starter categories nobody has added yet, already
 * filtered to this field's own direction by the caller (see
 * `useCreateCategory`'s `availableIncomePresets`/`availableExpensePresets`)
 * -- render as one-tap chips above the name input, same idea as the
 * Categories screen's own `CategoryChipPicker`. Without this, typing is
 * the *only* way in, which only beats More -> Categories for a name that
 * isn't already one of the sixteen starter presets; for one that is, it's
 * a guessing game against text nobody can see. Tapping a chip runs the
 * exact same `create` call a typed name would (with the preset's own
 * translated name), so it goes through the identical outcome handling
 * below rather than a second path that could disagree with it.
 *
 * Deliberately no group field and no income/expense checkbox, unlike
 * CategoriesScreen's fuller form: both callers already know which side of
 * the ledger they're on -- the sheet from its Expense/Income toggle, Budget
 * from which section this sits under -- and asking again is a decision
 * someone has already made. No cancel button either: every caller reveals
 * this from a control that toggles, so backing out is the affordance that
 * opened it, and a third button on a 375px row costs width the name field
 * needs more.
 */
export default function NewCategoryField({
  isIncome,
  create,
  onCreated,
  presets = [],
  initialName = '',
  autoFocus = false,
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [clash, setClash] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  // Revealing the field is not the same as focusing its input -- the two
  // used to be tied to the same flag, which meant turning autofocus off
  // (so the keyboard doesn't cover a preset chip someone could tap
  // instead, see the caller's own comment) silently turned this off too
  // and brought back the exact bug it was written for: both callers open
  // this at the bottom of a scroll with something sticky pinned over that
  // edge -- the add sheet's submit bar, the nav bar on Budget -- and
  // without an explicit scroll the panel can render entirely underneath
  // it, invisible whether or not the keyboard ever opens. `center` rather
  // than `nearest` because the amount to clear is whatever that
  // particular overlay happens to be tall, and the middle of the scroll
  // is clear of every one of them. `smooth` degrades to an instant jump
  // under prefers-reduced-motion, matching this app's convention
  // elsewhere. Runs on every mount of this field (including the remount
  // `presetsReady` triggers), regardless of `autoFocus`.
  useEffect(() => {
    if (!ref.current) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Optional-called for the same reason `matchMedia` above is: jsdom
    // implements neither, and a layout nicety must not be what decides
    // whether this field renders at all under test.
    ref.current.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }, []);

  const typed = name.trim();

  // Shared by the typed-name submit and a preset chip tap: the outcome
  // handling doesn't care where the name came from, only what came back.
  const submitNamed = async (candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const result = await create(candidate, isIncome);
    setBusy(false);
    // The name is somebody's own expense category sitting on the income
    // side (or the reverse). Saying so beats both alternatives: creating
    // a second category of the same name, or refusing with nothing to act
    // on.
    if (result.outcome === 'other_direction') {
      setClash(trimmed);
      return;
    }
    if (!result.categoryId) return;
    setClash(null);
    setName('');
    onCreated(result.categoryId);
  };

  const submit = () => submitNamed(name);

  return (
    <div className="new-category" ref={ref}>
      {presets.length > 0 && (
        <div className="new-category-presets">
          <span className="field-label">{t('category.orPickPreset')}</span>
          <div className="category-chip-row">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="category-chip"
                disabled={busy}
                onClick={() => submitNamed(t(preset.key))}
              >
                <CategoryBadge category={{ preset_key: preset.key, is_income: preset.is_income }} />
                {t(preset.key)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="new-category-row">
        <div className="field-input">
          <input
            value={name}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- only ever set by a caller whose affordance was just tapped to reveal this field; the caret belongs in it.
            autoFocus={autoFocus}
            placeholder={t('category.namePlaceholder')}
            aria-label={t('category.namePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
              setClash(null);
            }}
            // Enter submits without a <form>: both callers render this
            // inside one of their own, where a nested form is invalid
            // HTML and a submit button would save a transaction instead
            // of a category.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              submit();
            }}
          />
        </div>
        <button type="button" className="btn" disabled={!typed || busy} onClick={submit}>
          {typed ? t('category.createNamed', { name: typed }) : t('category.create')}
        </button>
      </div>
      {clash && (
        <p className="field-label" role="status">
          {t(isIncome ? 'category.clashIsExpense' : 'category.clashIsIncome', { name: clash })}
        </p>
      )}
    </div>
  );
}
