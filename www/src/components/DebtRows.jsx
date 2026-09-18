import React from 'react';
import { useI18n } from '../i18n';
import BatchRows from './BatchRows';
import NumberField from './NumberField';

/**
 * New debts as a list of rows, for a screen wide enough to show one.
 *
 * A payoff plan is only worth looking at once every debt is in it, so
 * this screen's first action is inherently a batch: the card, the other
 * card, the car loan, the student loan. Four fields typed and saved four
 * times over is the same "type, save, retype" cycle the rules and
 * categories tabs had.
 *
 * Presentational -- every row lives in `DebtTab`'s state, and
 * `BatchRows` owns the header, the shortcut and the add/remove footer.
 *
 * Balance and minimum payment are `bare` `NumberField`s (grouped, so a
 * balance reads `12,400` at rest); APR is a bare ungrouped one carrying
 * the `%` suffix, matching the phone form's three fields exactly rather
 * than re-deciding any of it here.
 */
export default function DebtRows({ rows, onRowChange, onAddRow, onRemoveRow }) {
  const { t } = useI18n();

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  return (
    <BatchRows
      className="debt-rows"
      headers={[t('debt.name'), t('debt.balance'), t('debt.apr'), t('debt.minPayment')]}
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
              aria-label={rowLabel(t('debt.name'), i)}
              value={row.name}
              onChange={(e) => onRowChange(row.key, { name: e.target.value })}
            />
          </div>

          <NumberField
            bare
            grouped
            label={rowLabel(t('debt.balance'), i)}
            value={row.balance}
            onChange={(v) => onRowChange(row.key, { balance: v })}
          />

          <NumberField
            bare
            suffix="%"
            label={rowLabel(t('debt.apr'), i)}
            value={row.apr_percent}
            onChange={(v) => onRowChange(row.key, { apr_percent: v })}
          />

          <NumberField
            bare
            grouped
            label={rowLabel(t('debt.minPayment'), i)}
            value={row.min_payment}
            onChange={(v) => onRowChange(row.key, { min_payment: v })}
          />
        </>
      )}
    </BatchRows>
  );
}
