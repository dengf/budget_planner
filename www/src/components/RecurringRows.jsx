import React from 'react';
import { useI18n } from '../i18n';
import { categoryDisplayName } from '../presetCategories';
import BatchRows from './BatchRows';
import NumberField from './NumberField';

/**
 * New recurring expenses as a list of rows, for a screen wide enough to
 * show one.
 *
 * Recurring expenses are the most batch-shaped record this app holds:
 * rent, the phone bill, insurance, two streaming subscriptions and the
 * gym all exist on day one, and they are typed out together in the
 * sitting where someone decides to set the app up. The single draft form
 * this replaces on desktop made that six save-and-retype cycles across
 * five fields each.
 *
 * Presentational -- every row lives in `AddTransactionSheet`'s state, and
 * `BatchRows` owns the header, the Shift+Enter shortcut and the
 * add/remove footer.
 *
 * The amount is a `bare` `NumberField` rather than a plain input, so a
 * four-figure rent reads as `2,400` at rest exactly as it does in the
 * phone form -- the grouping and caret handling are that component's
 * job, and a second copy here is what would drift.
 */
export default function RecurringRows({
  rows,
  onRowChange,
  onAddRow,
  onRemoveRow,
  categories,
  cadences,
}) {
  const { t } = useI18n();

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  return (
    <BatchRows
      className="recurring-rows"
      headers={[
        t('recurring.description'),
        t('transactions.category'),
        t('recurring.amount'),
        t('recurring.cadence'),
        t('recurring.anchorDate'),
      ]}
      rows={rows}
      onAddRow={onAddRow}
      onRemoveRow={onRemoveRow}
      firstFieldSelector="input[data-row-description]"
    >
      {(row, i) => (
        <>
          <div className="field-input">
            <input
              type="text"
              data-row-description=""
              aria-label={rowLabel(t('recurring.description'), i)}
              value={row.description}
              onChange={(e) => onRowChange(row.key, { description: e.target.value })}
            />
          </div>

          <select
            className="field-select"
            aria-label={rowLabel(t('transactions.category'), i)}
            value={row.category_id}
            onChange={(e) => onRowChange(row.key, { category_id: e.target.value })}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryDisplayName(c, t)}
              </option>
            ))}
          </select>

          <NumberField
            bare
            grouped
            label={rowLabel(t('recurring.amount'), i)}
            value={row.amount}
            onChange={(v) => onRowChange(row.key, { amount: v })}
          />

          <select
            className="field-select"
            aria-label={rowLabel(t('recurring.cadence'), i)}
            value={row.cadence}
            onChange={(e) => onRowChange(row.key, { cadence: e.target.value })}
          >
            {cadences.map((c) => (
              <option key={c} value={c}>
                {t(`freq.${c}`)}
              </option>
            ))}
          </select>

          <div className="field-input">
            <input
              type="date"
              aria-label={rowLabel(t('recurring.anchorDate'), i)}
              value={row.anchor_date}
              onChange={(e) => onRowChange(row.key, { anchor_date: e.target.value })}
            />
          </div>
        </>
      )}
    </BatchRows>
  );
}
