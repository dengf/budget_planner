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
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(planned);

  // Re-seeds every time a different row's sheet opens -- the sheet stays
  // mounted (App.jsx's usual lazy-but-persistent pattern) so the draft
  // must not leak from the previously-edited category into this one.
  useEffect(() => {
    if (open) setAmount(planned);
  }, [open, planned]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    onSave(amount === '' ? 0 : amount);
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
            <NumberField label={t('budget.planned')} value={amount} onChange={setAmount} grouped />
            <button className="btn" type="submit">
              {t('budget.save')}
            </button>
          </form>

          {upcoming && upcoming.amount > 0 && (
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
