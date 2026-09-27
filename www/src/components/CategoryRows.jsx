import React from 'react';
import { useI18n } from '../i18n';
import BatchRows from './BatchRows';
import SubcategoryOfSelect from './SubcategoryOfSelect';

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
 * "Subcategory of" is optional: left at its default, the row is a
 * category of its own. Choosing a group files the row under it, and the
 * direction select then shows -- and is locked to -- the group's own
 * side of the ledger, because a subcategory can't be on the other one.
 */
export default function CategoryRows({ groups = [], rows, onRowChange, onAddRow, onRemoveRow }) {
  const { t } = useI18n();

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  return (
    <BatchRows
      className="category-rows"
      headers={[t('budget.categoryName'), t('transactions.entryType'), t('category.subcategoryOf')]}
      rows={rows}
      onAddRow={onAddRow}
      onRemoveRow={onRemoveRow}
      firstFieldSelector="input[data-row-name]"
    >
      {(row, i) => {
        const parent = row.parentId ? groups.find((g) => g.id === row.parentId) : null;
        const isIncome = parent ? Boolean(parent.is_income) : row.isIncome;
        return (
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
              value={isIncome ? 'income' : 'expense'}
              disabled={Boolean(parent)}
              onChange={(e) => onRowChange(row.key, { isIncome: e.target.value === 'income' })}
            >
              <option value="expense">{t('transactions.expense')}</option>
              <option value="income">{t('transactions.income')}</option>
            </select>

            <SubcategoryOfSelect
              groups={groups}
              ariaLabel={rowLabel(t('category.subcategoryOf'), i)}
              value={row.parentId ?? ''}
              onChange={(parentId) => onRowChange(row.key, { parentId })}
            />
          </>
        );
      }}
    </BatchRows>
  );
}
