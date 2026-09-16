import React from 'react';
import { useI18n } from '../i18n';
import { categoryDisplayName } from '../presetCategories';

/**
 * The manual form as a list of rows, for a screen wide enough to show
 * one -- someone sitting down with a week of receipts was opening the
 * same sheet fifteen times, once per transaction.
 *
 * Presentational: every row lives in `AddTransactionSheet`'s state, and
 * this only renders it and reports edits back. Rendered exclusively at
 * desktop width (`isDesktop`, from App); the phone keeps the
 * single-draft form above it, untouched.
 *
 * Direction is per row, not per sheet. A batch typed off a bank app is
 * a paycheck *and* five expenses, and a sheet-level Expense/Income
 * toggle would mean two passes over the same receipts.
 *
 * The category picker here is a `<select>`, not the chip grid the
 * single form uses: twelve chips are readable once and unusable
 * repeated down six rows. The chips stay the phone experience.
 *
 * Amounts are `type="text"` with `inputMode="decimal"`, the same
 * choice NumberField documents -- `type="number"` silently changes a
 * focused field's value when a scroll wheel passes over it, which on a
 * desktop table of amounts is a wrong number nobody typed.
 */
export default function TransactionRows({
  rows,
  onRowChange,
  onAddRow,
  onRemoveRow,
  expenseCategories,
  incomeCategories,
  categoryValue,
  today,
}) {
  const { t } = useI18n();

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  return (
    <div className="txn-rows">
      <div className="txn-rows-head" aria-hidden="true">
        <span className="field-label">{t('transactions.entryType')}</span>
        <span className="field-label">{t('transactions.amount')}</span>
        <span className="field-label">{t('transactions.description')}</span>
        <span className="field-label">{t('transactions.category')}</span>
        <span className="field-label">{t('transactions.date')}</span>
        <span />
      </div>

      {rows.map((row, i) => (
        <div className="txn-row" key={row.key}>
          <select
            className="field-select"
            aria-label={rowLabel(t('transactions.entryType'), i)}
            value={row.isIncome ? 'income' : 'expense'}
            onChange={(e) =>
              // Same reset the single form's toggle does: a category from
              // the other side of the ledger cannot stay selected.
              onRowChange(row.key, {
                isIncome: e.target.value === 'income',
                category_id: '',
                categoryTouched: false,
              })
            }
          >
            <option value="expense">{t('transactions.expense')}</option>
            <option value="income">{t('transactions.income')}</option>
          </select>

          <div className="field-input">
            <input
              type="text"
              inputMode="decimal"
              aria-label={rowLabel(t('transactions.amount'), i)}
              value={row.amount}
              onChange={(e) => {
                // Ignore anything that isn't a number under construction,
                // as NumberField does -- a stray letter would otherwise
                // blank the field mid-word.
                const raw = e.target.value;
                if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return;
                onRowChange(row.key, { amount: raw });
              }}
            />
          </div>

          <div className="field-input">
            <input
              type="text"
              aria-label={rowLabel(t('transactions.description'), i)}
              placeholder={t('transactions.descriptionPlaceholder')}
              value={row.description}
              onChange={(e) => onRowChange(row.key, { description: e.target.value })}
            />
          </div>

          <select
            className="field-select"
            aria-label={rowLabel(t('transactions.category'), i)}
            value={categoryValue(row) || ''}
            onChange={(e) =>
              onRowChange(row.key, { category_id: e.target.value, categoryTouched: true })
            }
          >
            <option value="">{t('transactions.uncategorized')}</option>
            {(row.isIncome ? incomeCategories : expenseCategories).map((c) => (
              <option key={c.id} value={c.id}>
                {categoryDisplayName(c, t)}
              </option>
            ))}
          </select>

          <div className="field-input">
            <input
              type="date"
              aria-label={rowLabel(t('transactions.date'), i)}
              value={row.date || today}
              onChange={(e) => onRowChange(row.key, { date: e.target.value })}
            />
          </div>

          <button
            type="button"
            className="btn secondary txn-row-remove"
            aria-label={t('transactions.removeRow', { n: i + 1 })}
            onClick={() => onRemoveRow(row.key)}
            disabled={rows.length === 1}
          >
            &#215;
          </button>
        </div>
      ))}

      <button type="button" className="btn secondary txn-rows-add" onClick={onAddRow}>
        + {t('transactions.addRow')}
      </button>
    </div>
  );
}
