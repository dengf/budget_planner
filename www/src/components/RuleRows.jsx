import React from 'react';
import { useI18n } from '../i18n';
import BatchRows from './BatchRows';
import { categoryDisplayName } from '../presetCategories';

/**
 * Categorization rules as a list of rows, for a screen wide enough to
 * show one.
 *
 * Rules arrive in batches, not one at a time: someone sits down with a
 * bank export and writes a dozen of them in a sitting ("starbucks ->
 * Dining", "ntuc -> Groceries", ...). The single draft row this replaces
 * on desktop made that twelve separate save-and-retype cycles.
 *
 * Presentational: every row lives in `RulesSection`'s state and this
 * only renders it and reports edits back. `BatchRows` owns the header,
 * the Shift+Enter shortcut and the add/remove footer.
 *
 * Priority is `type="text"` with `inputMode="numeric"`, the same choice
 * `TransactionRows` documents for amounts -- `type="number"` silently
 * changes a focused field when a scroll wheel passes over it, and a
 * priority nobody typed reorders which rule wins.
 */
export default function RuleRows({ rows, categories, onRowChange, onAddRow, onRemoveRow }) {
  const { t } = useI18n();

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  return (
    <BatchRows
      className="rule-rows"
      headers={[
        t('transactions.ruleKeyword'),
        t('transactions.category'),
        t('transactions.rulePriority'),
      ]}
      rows={rows}
      onAddRow={onAddRow}
      onRemoveRow={onRemoveRow}
      firstFieldSelector="input[data-row-keyword]"
    >
      {(row, i) => (
        <>
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
        </>
      )}
    </BatchRows>
  );
}
