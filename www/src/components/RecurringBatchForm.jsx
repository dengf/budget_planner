import React from 'react';
import { useI18n } from '../i18n';
import { CADENCES } from '../cadences';
import useBatchRows, { rowKey } from '../useBatchRows';
import RecurringRows from './RecurringRows';

export const EMPTY_RECURRING_DRAFT = {
  description: '',
  category_id: '',
  amount: '',
  cadence: 'monthly',
  anchor_date: '',
};

const emptyRecurringRow = () => ({ ...EMPTY_RECURRING_DRAFT, key: rowKey('recurring') });

/**
 * Every field required before a recurring expense will save, exported so
 * the phone's single draft form in AddTransactionSheet enforces exactly
 * the same rule -- neither shape can create one the other would have
 * rejected.
 */
export const isCompleteRecurring = (row) =>
  !!row.description.trim() && !!row.category_id && !!row.amount && !!row.anchor_date;

const isBlankRecurring = (row) =>
  !row.description.trim() && !row.category_id && !row.amount && !row.anchor_date;

/**
 * One save for every shape, so a recurring expense created on a phone,
 * in the Add sheet's rows or on the Recurring screen cannot disagree
 * about how the amount is parsed.
 */
export const saveRecurring = async (recurring, newId, row) => {
  await recurring.save({
    id: newId(),
    description: row.description,
    category_id: row.category_id,
    amount: Number(row.amount),
    cadence: row.cadence,
    anchor_date: row.anchor_date,
  });
};

/**
 * The desktop "type a batch of recurring expenses into rows, save once"
 * form.
 *
 * Extracted out of AddTransactionSheet for the same reason
 * `TransactionBatchForm` was: the same rows and the same save render
 * either inside that sheet's modal (reached from any tab's "+") or
 * directly on the page. `RecurringSection` embeds it inline on desktop,
 * since the schedule these rows land in is already on screen there and
 * covering it with a modal just to type five fields is a step for
 * nothing -- see that file's own doc comment.
 *
 * The rows live here rather than in either caller: unlike the
 * transaction batch, nothing outside this form ever writes into them.
 *
 * `onSaved` is optional. The sheet passes its own `onClose`, so a batch
 * add still closes it; the inline embedding leaves it out, since there
 * is no sheet to close -- the rows reset and stay put, ready for the
 * next one.
 */
export default function RecurringBatchForm({ recurring, categories, newId, onSaved }) {
  const { t } = useI18n();
  const { rows, setRow, addRow, removeRow, reset } = useBatchRows({
    emptyRow: emptyRecurringRow,
    isFilled: (row) => !!row.description.trim(),
  });

  const completeRows = rows.filter(isCompleteRecurring);

  /**
   * Saves every finished row in one pass.
   *
   * Half-finished rows -- a description and an amount with no real due
   * date yet -- are kept rather than saved or silently dropped, and
   * `onSaved` is withheld while there are any: in the sheet that means
   * it stays open instead of closing over a row that went nowhere.
   */
  const addRecurrings = async (e) => {
    e.preventDefault();
    if (completeRows.length === 0) return;
    for (const row of completeRows) await saveRecurring(recurring, newId, row);
    const unfinished = rows.filter((r) => !isCompleteRecurring(r) && !isBlankRecurring(r));
    reset(unfinished);
    if (unfinished.length === 0) onSaved?.();
  };

  // Counts what will actually be saved, so the button never promises
  // more than the rows hold.
  const submitLabel = () =>
    completeRows.length > 1
      ? t('recurring.addCount', { count: completeRows.length })
      : t('recurring.add');

  return (
    <form className="batch-form" onSubmit={addRecurrings}>
      <RecurringRows
        rows={rows}
        onRowChange={setRow}
        onAddRow={addRow}
        onRemoveRow={removeRow}
        categories={categories.items}
        cadences={CADENCES}
      />
      <p className="field-label">{t('recurring.anchorHint')}</p>
      <div className="batch-actions">
        <button className="btn" type="submit" disabled={completeRows.length === 0}>
          {submitLabel()}
        </button>
      </div>
    </form>
  );
}
