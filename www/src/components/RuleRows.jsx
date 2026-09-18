import React, { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { categoryDisplayName } from '../presetCategories';

/**
 * The rules form as a list of rows, for a screen wide enough to show one.
 *
 * Rules arrive in batches, not one at a time: someone sits down with a
 * bank export and writes a dozen of them in a sitting ("starbucks ->
 * Dining", "ntuc -> Groceries", ...). The single draft row this replaces
 * on desktop made that twelve separate save-and-retype cycles, and its
 * Shift+Enter shortcut saved the draft in place while the hint beside it
 * promised "adds a row" -- the hint described this form, which didn't
 * exist yet.
 *
 * Presentational, exactly as `TransactionRows` is: every row lives in
 * `RulesSection`'s state and this only renders it and reports edits back.
 * Rendered exclusively at desktop width (`isDesktop`, from App); the
 * phone keeps the single-draft form, which is the right shape for a
 * screen that fits three fields across.
 *
 * Priority is `type="text"` with `inputMode="numeric"`, the same choice
 * `TransactionRows` documents for amounts -- `type="number"` silently
 * changes a focused field when a scroll wheel passes over it, and a
 * priority nobody typed reorders which rule wins.
 */
export default function RuleRows({ rows, categories, onRowChange, onAddRow, onRemoveRow }) {
  const { t } = useI18n();
  const rowsRef = useRef(null);
  const focusNewRow = useRef(false);

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  /**
   * Shift+Enter means "next row", the same shortcut and the same reason
   * as `TransactionRows`: a batch can be typed without leaving the
   * keyboard. Plain Enter still submits the form -- the browser's own
   * behaviour, and the one people expect from a form -- which is exactly
   * why the shortcut needs a modifier.
   *
   * It only *adds* a row when there isn't one below: filling a keyword
   * already grows a fresh row underneath, so appending unconditionally
   * would leave a blank row stranded above the caret every time.
   *
   * The handler sits on the container rather than on every input:
   * `keydown` bubbles, so one listener covers all three controls in all
   * the rows, including rows that don't exist yet.
   */
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || !e.shiftKey) return;
    const from = e.target.closest('.rule-row');
    if (!from) return;
    e.preventDefault();
    const all = [...(rowsRef.current?.querySelectorAll('.rule-row') ?? [])];
    const next = all[all.indexOf(from) + 1];
    if (next) {
      next.querySelector('input[data-row-keyword]')?.focus();
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
    const keywords = rowsRef.current?.querySelectorAll('input[data-row-keyword]');
    keywords?.[keywords.length - 1]?.focus();
  }, [rows.length]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the rule guards against a div standing in for a control; nothing is activated here. This only listens for a shortcut bubbling out of the native inputs inside, each of which is already focusable and keyboard-operable on its own.
    <div className="rule-rows" ref={rowsRef} onKeyDown={onKeyDown}>
      <div className="rule-rows-head" aria-hidden="true">
        <span className="field-label">{t('transactions.ruleKeyword')}</span>
        <span className="field-label">{t('transactions.category')}</span>
        <span className="field-label">{t('transactions.rulePriority')}</span>
        <span />
      </div>

      {rows.map((row, i) => (
        <div className="rule-row" key={row.key}>
          <div className="field-input">
            <input
              type="text"
              data-row-keyword=""
              aria-label={rowLabel(t('transactions.ruleKeyword'), i)}
              value={row.keyword}
              onChange={(e) => onRowChange(row.key, { keyword: e.target.value })}
            />
          </div>

          <select
            className="field-select"
            aria-label={rowLabel(t('transactions.category'), i)}
            value={row.category_id}
            onChange={(e) => onRowChange(row.key, { category_id: e.target.value })}
          >
            <option value="">&#8212;</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryDisplayName(c, t)}
              </option>
            ))}
          </select>

          <div className="field-input">
            <input
              type="text"
              inputMode="numeric"
              aria-label={rowLabel(t('transactions.rulePriority'), i)}
              value={row.priority}
              onChange={(e) => {
                // Ignore anything that isn't a whole number under
                // construction, as TransactionRows does for amounts -- a
                // stray letter would otherwise blank the field mid-entry.
                // The leading minus is allowed: priority is signed, so a
                // rule can be pushed below the default 0.
                const raw = e.target.value;
                if (raw !== '' && !/^-?\d*$/.test(raw)) return;
                onRowChange(row.key, { priority: raw });
              }}
            />
          </div>

          <button
            type="button"
            className="btn secondary rule-row-remove"
            aria-label={t('transactions.removeRow', { n: i + 1 })}
            onClick={() => onRemoveRow(row.key)}
            disabled={rows.length === 1}
          >
            &#215;
          </button>
        </div>
      ))}

      <div className="rule-rows-foot">
        <button type="button" className="btn secondary rule-rows-add" onClick={onAddRow}>
          + {t('transactions.addRow')}
        </button>
        {/* The shortcut is the fast path, so it is written down rather
            than left to be discovered -- and the button stays, because a
            shortcut nobody is obliged to know is not an affordance. */}
        <span className="field-label rule-rows-hint">{t('transactions.addRowShortcut')}</span>
      </div>
    </div>
  );
}
