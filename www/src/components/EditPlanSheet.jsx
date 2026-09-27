import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import NumberField from './NumberField';

/**
 * The row-tap editor for one category's (or Savings') planned amount --
 * same bottom-sheet idiom `AddTransactionSheet` introduced for the `+`,
 * reused here so there is one modal shape in the app instead of the
 * inline `planned-input` cell BudgetTab's old four-column grid used to
 * carry. See the plan's "Budget, after" mockup: a row tap opens this
 * sheet rather than editing in place.
 *
 * Read-only figures (spent/received, remaining) are shown above the
 * field so the number being typed has context, but nothing here computes
 * them -- both arrive from the caller's own `budget_calc::build_month`
 * result, unchanged.
 *
 * `upcoming` is optional: when the category has a recurring amount due
 * this month, a one-tap "add to planned" line offers it, folding in what
 * used to be BudgetTab's standalone "Upcoming this month" `<details>` --
 * contextual to the one category being edited instead of a second global
 * list to scroll past.
 *
 * `subcategories` is optional too: for a group, each of its subcategories
 * with what it has spent and its own plan, if it has one. Planning a
 * subcategory is optional -- most people plan the group and let the
 * subcategories only sort where the money went -- so each has its own
 * field, saved with the group's by the one Save button. Once any
 * subcategory has an amount, the group's total *is* their sum
 * (`budget_calc::group_planned`) -- so the group's own field gives way to
 * that total, read-only, rather than sitting beside the subcategories as
 * a second number that used to be added on top of them. `groupPlanned`
 * is that Rust rule over the wasm boundary, run as the fields change so
 * the total shown is what Save will produce; nothing here adds amounts
 * itself. Saving a split clears the group's own amount, so it can't
 * quietly come back if the subcategories are later emptied.
 */
export default function EditPlanSheet({
  open,
  onClose,
  title,
  badge,
  subtitle,
  planned,
  spentLabel,
  spent,
  remaining,
  upcoming,
  formatMoney,
  onSave,
  subcategories = [],
  plannedTotal,
  onSaveSub,
  groupPlanned,
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(planned);
  const [subAmounts, setSubAmounts] = useState({});
  const [liveTotal, setLiveTotal] = useState(null);

  // Re-seeds every time a different row's sheet opens -- the sheet stays
  // mounted (App.jsx's usual lazy-but-persistent pattern) so the draft
  // must not leak from the previously-edited category into this one.
  useEffect(() => {
    if (open) setAmount(planned);
  }, [open, planned]);
  useEffect(() => {
    if (open) setSubAmounts({});
  }, [open, title]);

  const subValue = (sub) => subAmounts[sub.id] ?? (sub.planned > 0 ? sub.planned : '');
  const subNumbers = subcategories.map((sub) => Number(subValue(sub)) || 0);
  const splitBySub = subNumbers.some((n) => n > 0);
  const subKey = subNumbers.join(',');

  useEffect(() => {
    let cancelled = false;
    if (!open || !splitBySub || !groupPlanned) return undefined;
    Promise.resolve(groupPlanned(Number(amount) || 0, subNumbers)).then((result) => {
      if (!cancelled) setLiveTotal(result?.total ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `subKey` stands for `subNumbers`, which is rebuilt every render.
  }, [open, splitBySub, subKey, amount, groupPlanned]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    // A split group's total is its subcategories' sum; its own amount is
    // zeroed rather than left to resurface if the split is undone.
    if (splitBySub) {
      if (Number(planned) > 0) onSave(0);
    } else {
      onSave(amount === '' ? 0 : amount);
    }
    for (const [id, value] of Object.entries(subAmounts)) {
      const before = subcategories.find((s) => s.id === id)?.planned ?? 0;
      const after = value === '' || value == null ? 0 : Number(value);
      if (after !== before) onSaveSub?.(id, after);
    }
    onClose();
  };

  const addUpcoming = () => {
    const base = amount === '' || amount == null ? 0 : Number(amount);
    setAmount(base + upcoming.amount);
  };

  return (
    <div className="add-txn-backdrop" role="presentation" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- see AddTransactionSheet.jsx's identical comment: this only stops a click reaching the backdrop's dismiss handler above. */}
      <div
        className="add-txn-dialog edit-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="add-txn-header">
          <span className="add-txn-title edit-plan-title">
            {badge}
            {title}
          </span>
          <button
            type="button"
            className="dash-month-btn"
            aria-label={t('monthpicker.close')}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="add-txn-body">
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}

          <div className="edit-plan-stats">
            <div className="edit-plan-stat">
              <span className="cell-label">{spentLabel}</span>
              <span className="spent-value">{formatMoney(spent)}</span>
            </div>
            <div className="edit-plan-stat">
              <span className="cell-label">{t('budget.remaining')}</span>
              <span className={remaining.className}>{remaining.text}</span>
            </div>
          </div>

          <form className="form-grid" onSubmit={submit}>
            {splitBySub ? (
              <div className="edit-plan-stat edit-plan-total">
                <span className="cell-label">{t('budget.plannedTotal')}</span>
                <span className="num">{formatMoney(liveTotal ?? plannedTotal)}</span>
                <span className="field-label">{t('budget.plannedIsSubSum')}</span>
              </div>
            ) : (
              <NumberField
                label={t('budget.planned')}
                value={amount}
                onChange={setAmount}
                grouped
              />
            )}
            {subcategories.length > 0 && (
              <fieldset className="edit-plan-subs">
                <legend className="cell-label">{t('budget.subcategories')}</legend>
                <p className="field-label">{t('budget.subPlanHint', { name: title })}</p>
                {subcategories.map((sub) => (
                  <div className="edit-plan-sub" key={sub.id}>
                    <span className="edit-plan-sub-name">
                      {sub.name}
                      <span className="edit-plan-sub-spent">
                        {spentLabel}: {formatMoney(sub.spent)}
                      </span>
                    </span>
                    {sub.upcoming > 0 && (
                      <button
                        type="button"
                        className="btn secondary edit-plan-sub-upcoming"
                        onClick={() =>
                          setSubAmounts((prev) => {
                            const current = prev[sub.id] ?? sub.planned;
                            const base = current === '' || current == null ? 0 : Number(current);
                            return { ...prev, [sub.id]: base + sub.upcoming };
                          })
                        }
                      >
                        {t('recurring.addToPlanned')} {formatMoney(sub.upcoming)}
                      </button>
                    )}
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      className="edit-plan-sub-input"
                      aria-label={`${t('budget.planned')} — ${sub.name}`}
                      placeholder="0"
                      value={subValue(sub)}
                      onChange={(e) =>
                        setSubAmounts((prev) => ({ ...prev, [sub.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </fieldset>
            )}
            <button className="btn" type="submit">
              {t('budget.save')}
            </button>
          </form>

          {!splitBySub && upcoming && upcoming.amount > 0 && (
            <div className="upcoming-total-row">
              <span className="upcoming-total-name">{t('recurring.upcomingTitle')}</span>
              <span className="upcoming-total-amount">{formatMoney(upcoming.amount)}</span>
              <button type="button" className="btn secondary upcoming-add" onClick={addUpcoming}>
                {t('recurring.addToPlanned')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
