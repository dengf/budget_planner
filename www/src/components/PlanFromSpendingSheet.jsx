import React from 'react';
import { useI18n } from '../i18n';
import { monthLabel } from '../month';
import { categoryDisplayName } from '../presetCategories';
import CategoryBadge from './CategoryBadge';
import NumberField from './NumberField';

/**
 * Review-before-save for the budget `budget_calc::suggest_plan_from_spending`
 * proposed out of someone's own transactions.
 *
 * Every row shows its working -- "you spent $187.43" beside "plan $190" --
 * because a figure the app arrived at silently is one nobody can check,
 * and this screen's whole job is to turn a stranger's numbers into the
 * reader's own. Nothing here computes: the observed amount, the planned
 * amount, both totals and the leftover all arrive from Rust already
 * decided.
 *
 * Amounts are deliberately not editable in place. The Budget tab is the
 * one screen that edits a planned amount (`EditPlanSheet`), and a second
 * editor for the same field is how the two drift; the sheet says so
 * instead, and the tab is one tap away once this is saved.
 */
export default function PlanFromSpendingSheet({
  open,
  onClose,
  suggestion,
  incomeOverride,
  setIncomeOverride,
  onApply,
  applying,
  categories,
  viewMonth,
  formatMoney,
  locale,
}) {
  const { t } = useI18n();
  if (!open || !suggestion) return null;

  const categoryFor = (id) => categories.items.find((c) => c.id === id);
  const nameFor = (id) => {
    const category = categoryFor(id);
    return category ? categoryDisplayName(category, t) : id;
  };

  const incomeCategories = categories.items.filter((c) => c.is_income);
  const needsIncome = suggestion.state === 'no_income_observed';
  const ready = suggestion.state === 'ready';

  const setOverrideAmount = (value) => {
    const amount = Number(value);
    // An emptied field clears the override outright rather than sending a
    // zero: zero is an income figure, and "I haven't said yet" is not.
    if (value === '' || !Number.isFinite(amount) || amount <= 0) {
      setIncomeOverride(null);
      return;
    }
    setIncomeOverride({
      category_id: incomeOverride?.category_id ?? incomeCategories[0]?.id,
      planned: amount,
    });
  };

  const renderRow = (row) => (
    <li className="suggest-row" key={row.category_id}>
      <CategoryBadge category={categoryFor(row.category_id)} />
      <span className="suggest-row-name">{nameFor(row.category_id)}</span>
      <span className="suggest-row-observed">
        {t(row.is_income ? 'planFromSpending.observedReceived' : 'planFromSpending.observedSpent', {
          amount: formatMoney(row.observed),
        })}
      </span>
      <span className="suggest-row-planned">{formatMoney(row.planned)}</span>
    </li>
  );

  const incomeRows = suggestion.rows.filter((r) => r.is_income);
  const expenseRows = suggestion.rows.filter((r) => !r.is_income);

  return (
    <div className="add-txn-backdrop" role="presentation" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- see AddTransactionSheet.jsx's identical comment: this only stops a click reaching the backdrop's dismiss handler above. */}
      <div
        className="add-txn-dialog suggest-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('planFromSpending.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="add-txn-header">
          <span className="add-txn-title">{t('planFromSpending.title')}</span>
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
          {/* Which months these came from, always -- a per-month average
              over finished months and a running total of a month three
              days old are different claims, and the sheet must not let
              them look alike. */}
          {/* Separate keys for the one-of-something cases rather than a
              plural engine -- see i18n/index.jsx on why there isn't one. */}
          <p className="panel-subtitle">
            {suggestion.basis !== 'complete_months'
              ? t('planFromSpending.basisPartial', { month: monthLabel(viewMonth, locale) })
              : suggestion.months_observed === 1
                ? t('planFromSpending.basisCompleteOne')
                : t('planFromSpending.basisComplete', { count: suggestion.months_observed })}
          </p>

          {suggestion.uncategorized > 0 && (
            <p className="suggest-note">
              {suggestion.uncategorized === 1
                ? t('planFromSpending.uncategorizedOne')
                : t('planFromSpending.uncategorized', { count: suggestion.uncategorized })}
            </p>
          )}

          {needsIncome &&
            (incomeCategories.length > 0 ? (
              <div className="suggest-income-ask">
                <p className="suggest-note">{t('planFromSpending.askIncome')}</p>
                {incomeCategories.length > 1 && (
                  <label className="field">
                    <span className="field-label">{t('planFromSpending.incomeCategory')}</span>
                    <select
                      className="field-select"
                      value={incomeOverride?.category_id ?? incomeCategories[0].id}
                      onChange={(e) =>
                        setIncomeOverride(
                          incomeOverride
                            ? { ...incomeOverride, category_id: e.target.value }
                            : null,
                        )
                      }
                    >
                      {incomeCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryDisplayName(c, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <NumberField
                  label={t('planFromSpending.monthlyIncome')}
                  value={incomeOverride?.planned ?? ''}
                  onChange={setOverrideAmount}
                  grouped
                />
              </div>
            ) : (
              // The same dead end `budget.startWithIncomeCategory` names:
              // there is nowhere on this screen to make a category, so say
              // where there is.
              <p className="suggest-note">{t('budget.startWithIncomeCategory')}</p>
            ))}

          {incomeRows.length > 0 && (
            <>
              <h2 className="section-start">{t('budget.income')}</h2>
              <ul className="suggest-rows">{incomeRows.map(renderRow)}</ul>
            </>
          )}

          <h2 className="section-start">{t('planFromSpending.expenses')}</h2>
          <ul className="suggest-rows">{expenseRows.map(renderRow)}</ul>

          <div className="suggest-totals">
            <div className="suggest-total">
              <span className="cell-label">{t('budget.income')}</span>
              <span className="stat-value">{formatMoney(suggestion.total_income)}</span>
            </div>
            <div className="suggest-total">
              {/* Not `budget.totalPlanned`: that figure on the Budget tab
                  includes the savings target, and this one is the spending
                  rows only. One label for two different numbers is the
                  quietly-wrong kind of mistake. */}
              <span className="cell-label">{t('planFromSpending.totalExpenses')}</span>
              <span className="stat-value">{formatMoney(suggestion.total_expenses)}</span>
            </div>
          </div>

          {/* Savings and shortfall are never both true -- budget-calc
              returns one or neither -- so this reads as the single
              statement it is rather than a pair of possibilities. */}
          {suggestion.savings != null && (
            <p className="suggest-outcome positive">
              {t('planFromSpending.savings', { amount: formatMoney(suggestion.savings) })}
            </p>
          )}
          {suggestion.shortfall != null && (
            <p className="suggest-outcome negative">
              {t('planFromSpending.shortfall', { amount: formatMoney(suggestion.shortfall) })}
            </p>
          )}

          <button type="button" className="btn" disabled={!ready || applying} onClick={onApply}>
            {applying ? t('planFromSpending.applying') : t('planFromSpending.apply')}
          </button>
          <p className="suggest-note">{t('planFromSpending.editLater')}</p>
        </div>
      </div>
    </div>
  );
}
