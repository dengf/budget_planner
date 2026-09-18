import React from 'react';
import { useI18n } from '../i18n';
import { CADENCES } from '../cadences';
import BatchRows from './BatchRows';
import NumberField from './NumberField';

/**
 * New savings goals as a list of rows, for a screen wide enough to show
 * one.
 *
 * Goals are set up in a sitting, the same way categories and rules are
 * -- someone deciding to budget writes down the emergency fund, the trip
 * and the new laptop in one go, not across three visits. The single
 * draft form this replaces on desktop made that three save-and-retype
 * cycles across four fields each.
 *
 * Presentational -- every row lives in `GoalsTab`'s state, and
 * `BatchRows` owns the header, the Shift+Enter shortcut and the
 * add/remove footer.
 *
 * The target amount is a `bare` `NumberField` rather than a plain input,
 * so a five-figure goal reads as `25,000` at rest exactly as it does in
 * the phone form -- the grouping and caret handling are that component's
 * job, and a second copy here is what would drift.
 */
export default function GoalRows({ rows, onRowChange, onAddRow, onRemoveRow }) {
  const { t } = useI18n();

  // The column headers are visual, so every control names its own row
  // for a screen reader instead of leaning on them.
  const rowLabel = (field, index) => t('transactions.rowField', { field, n: index + 1 });

  return (
    <BatchRows
      className="goal-rows"
      headers={[t('goals.name'), t('goals.target'), t('goals.targetDate'), t('goals.cadence')]}
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
              aria-label={rowLabel(t('goals.name'), i)}
              value={row.name}
              onChange={(e) => onRowChange(row.key, { name: e.target.value })}
            />
          </div>

          <NumberField
            bare
            grouped
            label={rowLabel(t('goals.target'), i)}
            value={row.target_amount}
            onChange={(v) => onRowChange(row.key, { target_amount: v })}
          />

          <div className="field-input">
            <input
              type="date"
              aria-label={rowLabel(t('goals.targetDate'), i)}
              value={row.target_date}
              onChange={(e) => onRowChange(row.key, { target_date: e.target.value })}
            />
          </div>

          <select
            className="field-select"
            aria-label={rowLabel(t('goals.cadence'), i)}
            value={row.cadence}
            onChange={(e) => onRowChange(row.key, { cadence: e.target.value })}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {t(`freq.${c}`)}
              </option>
            ))}
          </select>
        </>
      )}
    </BatchRows>
  );
}
