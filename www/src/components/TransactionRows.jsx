import React, { useEffect, useRef } from 'react';
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
  const rowsRef = useRef(null);
  const focusNewRow = useRef(false);

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  /**
   * Shift+Enter means "next row", so a batch can be typed without
   * leaving the keyboard. Plain Enter still submits the form -- the
   * browser's own behaviour, and the one people expect from a form --
   * which is exactly why the shortcut needs a modifier.
   *
   * It only *adds* a row when there isn't one below: filling an amount
   * already grows a fresh row underneath, so appending unconditionally
   * would leave a blank row stranded above the caret every time.
   *
   * The handler sits on the container rather than on every input:
   * `keydown` bubbles, so one listener covers all six controls in all
   * the rows, including rows that don't exist yet.
   */
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || !e.shiftKey) return;
    const from = e.target.closest('.txn-row');
    if (!from) return;
    e.preventDefault();
    const all = [...(rowsRef.current?.querySelectorAll('.txn-row') ?? [])];
    const next = all[all.indexOf(from) + 1];
    if (next) {
      next.querySelector('input[data-row-amount]')?.focus();
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
    const amounts = rowsRef.current?.querySelectorAll('input[data-row-amount]');
    amounts?.[amounts.length - 1]?.focus();
  }, [rows.length]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the rule guards against a div standing in for a control; nothing is activated here. This only listens for a shortcut bubbling out of the native inputs inside, each of which is already focusable and keyboard-operable on its own.
    <div className="txn-rows" ref={rowsRef} onKeyDown={onKeyDown}>
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
              data-row-amount=""
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

      <div className="txn-rows-foot">
        <button type="button" className="btn secondary txn-rows-add" onClick={onAddRow}>
          + {t('transactions.addRow')}
        </button>
        {/* The shortcut is the fast path, so it is written down rather
            than left to be discovered -- and the button stays, because a
            shortcut nobody is obliged to know is not an affordance. */}
        <span className="field-label txn-rows-hint">{t('transactions.addRowShortcut')}</span>
      </div>
    </div>
  );
}
