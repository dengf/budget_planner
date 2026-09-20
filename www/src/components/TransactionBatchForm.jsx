import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import CalcError from './CalcError';
import TransactionRows from './TransactionRows';
import { categoryDisplayName } from '../presetCategories';
import { useCategoryRank } from '../useCategoryRank';

let rowSeq = 0;
export const emptyRow = (date = '') => ({
  date,
  description: '',
  amount: '',
  category_id: '',
  isIncome: false,
  categoryTouched: false,
  key: `batch-row-${(rowSeq += 1)}`,
});

/**
 * The desktop "type a batch of receipts into rows, save once" form.
 *
 * Extracted out of AddTransactionSheet so the same rows/rules/save logic
 * can render either inside that sheet's modal (every other tab's "+")
 * or directly on the page -- TransactionsTab embeds this inline on
 * desktop instead of opening a modal just to type a number, since the
 * list these rows land in is already on screen. See TransactionsTab's
 * own doc comment for that call.
 *
 * `rows`/`setRows` are lifted to the caller rather than owned here:
 * AddTransactionSheet's receipt-capture tab writes a parsed transaction
 * into the current batch rows, so that state has to live somewhere both
 * it and this form can reach. TransactionsTab, which has no such tab,
 * just keeps its own local pair.
 *
 * `onSaved` is optional: the sheet passes its own `onClose` so a batch
 * add still closes the sheet as before; the inline embedding leaves it
 * out, since there is no sheet to close -- the rows simply reset and
 * stay put, ready for the next entry.
 */
export default function TransactionBatchForm({
  rows,
  setRows,
  wasmModule,
  newId,
  today,
  categories,
  rules,
  transactions,
  formatMoney,
  onSaved,
}) {
  const { t } = useI18n();
  const [rowRuleMatches, setRowRuleMatches] = useState({});
  const [saveError, setSaveError] = useState(null);

  const expenseRank = useCategoryRank({
    wasmModule,
    categories: categories.items,
    transactions: transactions.items,
    today,
    isIncome: false,
  });
  const incomeRank = useCategoryRank({
    wasmModule,
    categories: categories.items,
    transactions: transactions.items,
    today,
    isIncome: true,
  });

  const categoryName = (id) =>
    categoryDisplayName(
      categories.items.find((c) => c.id === id),
      t,
    );

  // What the rows actually say, as one string -- see AddTransactionSheet's
  // identical pattern for why this is keyed on instead of the array
  // identity every unrelated keystroke produces.
  const rowsSignature = rows
    .map((r) => `${r.key}:${r.description}:${r.date}:${r.isIncome}`)
    .join('|');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const notes = rows.filter((r) => r.description.trim());
      const canMatch = notes.length > 0 && rules.items.length > 0 && wasmModule?.apply_rules;
      const result = canMatch
        ? await wasmModule.apply_rules({
            transactions: notes.map((r) => ({
              id: r.key,
              date: r.date || today,
              description: r.description.trim(),
              amount: r.isIncome ? 1 : -1,
              category_id: null,
            })),
            rules: rules.items,
          })
        : null;
      if (cancelled) return;
      if (!result || result.error) {
        setRowRuleMatches({});
        return;
      }
      setRowRuleMatches(
        Object.fromEntries(
          (result.transactions ?? [])
            .filter((tx) => tx.category_id)
            .map((tx) => [tx.id, tx.category_id]),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rows` is read through `rowsSignature` above, which is the dependency that should trigger this.
  }, [wasmModule, rules.items, today, rowsSignature]);

  const rowCategoryValue = (row) => {
    if (row.categoryTouched) return row.category_id;
    const rank = row.isIncome ? incomeRank : expenseRank;
    return rowRuleMatches[row.key] ?? rank.suggestionId ?? '';
  };

  const filledRows = rows.filter((r) => r.amount !== '' && Number(r.amount) > 0);

  const setRow = (key, patch) => {
    setRows((current) => {
      const next = current.map((r) => (r.key === key ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      return last.amount !== '' ? [...next, emptyRow(last.date)] : next;
    });
  };

  const addRow = () =>
    setRows((current) => [...current, emptyRow(current[current.length - 1].date)]);

  const removeRow = (key) =>
    setRows((current) => (current.length === 1 ? current : current.filter((r) => r.key !== key)));

  const addBatch = async (e) => {
    e.preventDefault();
    if (filledRows.length === 0) return;
    if (!wasmModule?.signed_amount) return;
    for (const row of filledRows) {
      const signed = await wasmModule.signed_amount({
        magnitude: Number(row.amount),
        is_income: row.isIncome,
      });
      if (signed?.error) {
        setSaveError(signed);
        return;
      }
      const rowCategory = rowCategoryValue(row);
      const fallback = rowCategory
        ? categoryName(rowCategory)
        : t(row.isIncome ? 'transactions.income' : 'transactions.expense');
      await transactions.save({
        id: newId(),
        date: row.date || today,
        description: row.description.trim() || fallback,
        amount: signed.amount,
        category_id: rowCategory || null,
      });
      setRows((current) => {
        const left = current.filter((r) => r.key !== row.key);
        return left.length === 0 ? [emptyRow(row.date)] : left;
      });
    }
    setSaveError(null);
    onSaved?.();
  };

  const batchSubmitLabel = () => {
    if (filledRows.length > 1) {
      return t('transactions.addCount', { count: filledRows.length });
    }
    const row = filledRows[0];
    if (!row) return t('transactions.addExpense');
    const amount = formatMoney(Math.abs(Number(row.amount)));
    const rowCategory = rowCategoryValue(row);
    return rowCategory
      ? t('transactions.addAmountTo', { amount, category: categoryName(rowCategory) })
      : t('transactions.addAmount', { amount });
  };

  return (
    <form className="txn-batch" onSubmit={addBatch}>
      <TransactionRows
        rows={rows}
        onRowChange={setRow}
        onAddRow={addRow}
        onRemoveRow={removeRow}
        expenseCategories={expenseRank.ordered}
        incomeCategories={incomeRank.ordered}
        categoryValue={rowCategoryValue}
        today={today}
      />
      {saveError && <CalcError result={saveError} />}
      <div className="add-txn-submit-bar">
        <button className="btn" type="submit" disabled={filledRows.length === 0}>
          {batchSubmitLabel()}
        </button>
      </div>
    </form>
  );
}
