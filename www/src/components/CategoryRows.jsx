import React from 'react';
import { useI18n } from '../i18n';
import BatchRows from './BatchRows';

/**
 * The new-category form as a list of rows, for a screen wide enough to
 * show one: setting a budget up means naming eight or ten categories in
 * a sitting, not one.
 *
 * Presentational -- every row lives in `CategoriesScreen`'s state, and
 * `BatchRows` owns the header, the shortcut and the add/remove footer.
 *
 * Direction is a select, not the single form's checkbox. A checkbox
 * reading "This is an income category" is fine stated once, but repeated
 * down eight rows it is a column of unlabelled boxes -- and it only ever
 * names one of the two things a row can be. The select says both.
 *
 * Group is optional and shows its fallback as a placeholder rather than
 * leaving the default unsaid: an empty group is filed under
 * "Income"/"Expense", and someone scanning eight rows should be able to
 * see that without saving one to find out.
 */
export default function CategoryRows({ rows, onRowChange, onAddRow, onRemoveRow }) {
  const { t } = useI18n();

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  return (
    <BatchRows
      className="category-rows"
      headers={[t('budget.categoryName'), t('transactions.entryType'), t('budget.categoryGroup')]}
      rows={rows}
      onAddRow={onAddRow}
      onRemoveRow={onRemoveRow}
      firstFieldSelector="input[data-row-name]"
    >
      {(row, i) => (
        <>
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
        </>
      )}
    </BatchRows>
  );
}
