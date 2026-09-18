import React, { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';

/**
 * The new-category form as a list of rows, for a screen wide enough to
 * show one.
 *
 * Third instance of the pattern `TransactionRows` started and `RuleRows`
 * followed, and for the same reason: setting a budget up means naming
 * eight or ten categories in a sitting, not one. The single draft row it
 * replaces on desktop made that eight save-and-retype cycles, with a
 * Shift+Enter that saved in place rather than opening the next row.
 *
 * Presentational: every row lives in `CategoriesScreen`'s state and this
 * only renders it and reports edits back. Rendered exclusively at desktop
 * width (`isDesktop`, from App); the phone keeps the single-draft form.
 *
 * Direction is a select, not the single form's checkbox. A checkbox
 * reading "This is an income category" is fine stated once, but repeated
 * down eight rows it is a column of unlabelled boxes -- and it only ever
 * names one of the two things a row can be. The select says both.
 *
 * Group is optional and shows its fallback as a placeholder rather than
 * leaving the field blank and the default unsaid: an empty group is
 * filed under "Income"/"Expense", and someone scanning eight rows should
 * be able to see that without saving one to find out.
 */
export default function CategoryRows({ rows, onRowChange, onAddRow, onRemoveRow }) {
  const { t } = useI18n();
  const rowsRef = useRef(null);
  const focusNewRow = useRef(false);

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  /**
   * Shift+Enter means "next row" -- identical handler, identical
   * reasoning, to `RuleRows` and `TransactionRows`. Plain Enter still
   * submits the form, which is why the shortcut needs a modifier; the
   * listener sits on the container because `keydown` bubbles and rows
   * that do not exist yet need covering too.
   */
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || !e.shiftKey) return;
    const from = e.target.closest('.category-row');
    if (!from) return;
    e.preventDefault();
    const all = [...(rowsRef.current?.querySelectorAll('.category-row') ?? [])];
    const next = all[all.indexOf(from) + 1];
    if (next) {
      next.querySelector('input[data-row-name]')?.focus();
      return;
    }
    focusNewRow.current = true;
    onAddRow();
  };

  // Focus after React has committed the new row -- the input does not
  // exist yet at the moment the shortcut fires.
  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    const names = rowsRef.current?.querySelectorAll('input[data-row-name]');
    names?.[names.length - 1]?.focus();
  }, [rows.length]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the rule guards against a div standing in for a control; nothing is activated here. This only listens for a shortcut bubbling out of the native inputs inside, each of which is already focusable and keyboard-operable on its own.
    <div className="category-rows" ref={rowsRef} onKeyDown={onKeyDown}>
      <div className="category-rows-head" aria-hidden="true">
        <span className="field-label">{t('budget.categoryName')}</span>
        <span className="field-label">{t('transactions.entryType')}</span>
        <span className="field-label">{t('budget.categoryGroup')}</span>
        <span />
      </div>

      {rows.map((row, i) => (
        <div className="category-row" key={row.key}>
          <div className="field-input">
            <input
              type="text"
              data-row-name=""
              aria-label={rowLabel(t('budget.categoryName'), i)}
              value={row.name}
              onChange={(e) => onRowChange(row.key, { name: e.target.value })}
            />
          </div>

          <select
            className="field-select"
            aria-label={rowLabel(t('transactions.entryType'), i)}
            value={row.isIncome ? 'income' : 'expense'}
            onChange={(e) => onRowChange(row.key, { isIncome: e.target.value === 'income' })}
          >
            <option value="expense">{t('transactions.expense')}</option>
            <option value="income">{t('transactions.income')}</option>
          </select>

          <div className="field-input">
            <input
              type="text"
              aria-label={rowLabel(t('budget.categoryGroup'), i)}
              // The group this row lands in if it is left alone -- the
              // same fallback `CategoriesScreen` saves, said out loud.
              placeholder={t(row.isIncome ? 'cat.group.income' : 'cat.group.expense')}
              value={row.group}
              onChange={(e) => onRowChange(row.key, { group: e.target.value })}
            />
          </div>

          <button
            type="button"
            className="btn secondary category-row-remove"
            aria-label={t('transactions.removeRow', { n: i + 1 })}
            onClick={() => onRemoveRow(row.key)}
            disabled={rows.length === 1}
          >
            &#215;
          </button>
        </div>
      ))}

      <div className="category-rows-foot">
        <button type="button" className="btn secondary category-rows-add" onClick={onAddRow}>
          + {t('transactions.addRow')}
        </button>
        {/* The shortcut is the fast path, so it is written down rather
            than left to be discovered -- and the button stays, because a
            shortcut nobody is obliged to know is not an affordance. */}
        <span className="field-label category-rows-hint">{t('transactions.addRowShortcut')}</span>
      </div>
    </div>
  );
}
