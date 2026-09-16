import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import CalcError from './CalcError';
import CategoryPicker from './CategoryPicker';
import NumberField from './NumberField';
import ReceiptCapture from './ReceiptCapture';
import TransactionRows from './TransactionRows';
import VoiceCapture from './VoiceCapture';
import { PenIcon, CameraIcon, MicIcon, SpreadsheetIcon, RecurringIcon } from './icons';
import { categoryDisplayName } from '../presetCategories';
import { useCategoryRank } from '../useCategoryRank';
import { useCreateCategory } from '../useCreateCategory';

const DEFAULT_MAPPING = {
  date_col: 0,
  description_col: 1,
  amount_col: 2,
  credit_col: null,
  has_header: true,
};

/**
 * `categoryTouched` is not part of the record -- it's the difference
 * between "this category is a suggestion" and "this category is the
 * person's answer". Until they touch the picker, the selected category
 * is derived on every render from the rule match and the ranking, so it
 * keeps up with what they type in the note; the moment they tap a chip,
 * their choice stops moving under them.
 */
const EMPTY_DRAFT = {
  date: '',
  description: '',
  amount: '',
  category_id: '',
  isIncome: false,
  categoryTouched: false,
};

const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

/**
 * One row of the desktop batch form. `key` is React's identity for the
 * row and the handle every edit, removal and rule match is addressed
 * by -- the array index would shift under a removal and hand a row
 * another row's category.
 *
 * A new row copies the date of the row above it: a batch is usually a
 * day's receipts, so the date is set once, not once per row.
 */
let rowSeq = 0;
const emptyRow = (date = '') => ({ ...EMPTY_DRAFT, date, key: `row-${(rowSeq += 1)}` });

const EMPTY_RECURRING_DRAFT = {
  description: '',
  category_id: '',
  amount: '',
  cadence: 'monthly',
  anchor_date: '',
};

/**
 * The four ways a transaction (or a recurring expense that generates
 * future ones) enters the app -- manual entry, a photographed/PDF
 * receipt, a bank CSV export, a recurring rule -- collapsed behind one
 * "+" in the centre of the nav bar (Header.jsx) instead of
 * permanently-expanded sections stacked above the transaction list. That
 * "+" started life as a floating button on Transactions itself and moved
 * to the bar when the sheet became reachable from every tab. Manual is the
 * default tab: it needs no file and no OCR wait, the quickest path for
 * the single most common case of logging one thing just spent. Closes
 * itself after a manual or recurring add (both genuine one-shot
 * actions); receipt and CSV import stay open afterward since scanning a
 * second receipt or re-running an import with adjusted columns are both
 * real, common follow-ups.
 */
export default function AddTransactionSheet({
  open,
  onClose,
  wasmModule,
  newId,
  today,
  categories,
  rules,
  transactions,
  recurring,
  formatMoney,
  initialMethod = 'manual',
  editing = null,
  // Off unless App says otherwise, which is what keeps every phone --
  // and every existing test -- on the single-draft form below.
  isDesktop = false,
}) {
  const { t } = useI18n();
  const [method, setMethod] = useState(initialMethod); // 'manual' | 'receipt' | 'voice' | 'csv' | 'recurring'

  // The sheet stays mounted (and its state alive) even while closed, so a
  // caller that reopens it wanting a specific tab -- the Transactions
  // empty state's "Import CSV" button -- needs this to actually take
  // effect on each open, not just the first mount.
  useEffect(() => {
    if (open) setMethod(initialMethod);
  }, [open, initialMethod]);

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  // The desktop batch form's rows. Correcting a row is still one row, so
  // `editing` keeps the single form even at desktop width.
  const [rows, setRows] = useState(() => [emptyRow()]);
  const [rowRuleMatches, setRowRuleMatches] = useState({});
  const [csvText, setCsvText] = useState('');
  const [mapping, setMapping] = useState(DEFAULT_MAPPING);
  const [columnsDetected, setColumnsDetected] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [recurringDraft, setRecurringDraft] = useState(EMPTY_RECURRING_DRAFT);
  const [ruleMatch, setRuleMatch] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleSaved, setRuleSaved] = useState(null);

  /**
   * Loads the transaction being corrected into the draft.
   *
   * The stored amount is signed; the form collects a magnitude and a
   * direction separately (see the Expense/Income toggle below), so
   * `budget_calc::split_amount` does the pulling apart and
   * `signed_amount` puts it back together on save. Doing either half
   * here in JS is how an edit ends up flipping a transaction's sign:
   * two implementations of the same rule, only one of them tested.
   *
   * The category comes across as already-touched -- it is the person's
   * own earlier answer, not a suggestion for the ranking to overwrite a
   * render later.
   */
  useEffect(() => {
    if (!open || !editing) return undefined;
    let cancelled = false;
    (async () => {
      const split = wasmModule?.split_amount ? await wasmModule.split_amount(editing.amount) : null;
      if (cancelled) return;
      if (split?.error) {
        setSaveError(split);
        return;
      }
      setDraft({
        date: editing.date || '',
        description: editing.description || '',
        amount: split ? String(split.magnitude) : '',
        category_id: editing.category_id || '',
        isIncome: Boolean(split?.is_income),
        categoryTouched: Boolean(editing.category_id),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editing, wasmModule]);

  /**
   * Seeds the "make a rule from this" keyword from the description --
   * `budget_calc::suggest_rule_keyword` trims a bank's branch and
   * reference noise off the merchant name. It is a suggestion and lands
   * in an editable field, never straight into a saved rule.
   */
  useEffect(() => {
    if (!open || !editing) return undefined;
    let cancelled = false;
    (async () => {
      const result = wasmModule?.suggest_rule_keyword
        ? await wasmModule.suggest_rule_keyword({ description: editing.description || '' })
        : null;
      if (cancelled) return;
      setRuleKeyword(result?.error ? '' : (result?.keyword ?? ''));
      // A confirmation left over from the previous transaction would
      // claim a rule was saved for this one.
      setRuleSaved(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editing, wasmModule]);

  const { ordered, suggestionId } = useCategoryRank({
    wasmModule,
    categories: categories.items,
    transactions: transactions.items,
    today,
    isIncome: draft.isIncome,
  });

  // The batch rows below each carry their own direction, so both sides
  // of the ledger have to be ranked at once rather than following one
  // toggle. Called unconditionally (hooks always are) and simply unused
  // on a phone, where `batch` is false.
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

  const createCategory = useCreateCategory({ wasmModule, categories, newId });

  /**
   * The same `budget_calc::apply_rules` that files imported CSV rows,
   * run against what's being typed right now -- so a rule someone wrote
   * once ("uber -> Transport") does its work at the moment of entry
   * instead of only on a later bulk re-run. The draft is handed over as
   * a throwaway one-transaction list; nothing is saved here.
   *
   * Every setState is inside the async closure: a synchronous one in an
   * effect body is the cascading-render pattern React warns about, and
   * "no rule matched" is just as much a result as a match is.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const note = draft.description.trim();
      const canMatch = note && rules.items.length > 0 && wasmModule?.apply_rules;
      const result = canMatch
        ? await wasmModule.apply_rules({
            transactions: [
              {
                id: 'draft',
                date: draft.date || today,
                description: note,
                amount: draft.isIncome ? 1 : -1,
                category_id: null,
              },
            ],
            rules: rules.items,
          })
        : null;
      const matched = result?.error ? null : (result?.transactions?.[0]?.category_id ?? null);
      if (!cancelled) setRuleMatch(matched);
    })();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, rules.items, draft.description, draft.date, draft.isIncome, today]);

  // What the rows actually say, as one string: the effect below has to
  // re-run when a description, date or direction changes and *not* on
  // the new array identity every unrelated keystroke in the sheet
  // produces. Extracted rather than inlined in the dependency array so
  // the lint rule can still read it.
  const rowsSignature = rows
    .map((r) => `${r.key}:${r.description}:${r.date}:${r.isIncome}`)
    .join('|');

  /**
   * The same rules, for the batch form -- and in *one* call, not one per
   * row: `apply_rules` takes a list of transactions and returns them
   * categorized, which is how CSV import uses it. The row `key` rides
   * along as the transaction id, so the answers come back addressable
   * even after a row is removed mid-flight.
   */
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

  // Same precedence as the single form below: an explicit pick wins, then
  // a rule match, then the ranking's suggestion for that row's direction.
  const rowCategoryValue = (row) => {
    if (row.categoryTouched) return row.category_id;
    const rank = row.isIncome ? incomeRank : expenseRank;
    return rowRuleMatches[row.key] ?? rank.suggestionId ?? '';
  };

  // Derived, not stored: a suggestion that lived in state would need an
  // effect to keep it in step with the note, and the moment two effects
  // can both write `category_id` one of them starts winning races.
  const suggested = ruleMatch ?? suggestionId ?? '';
  const categoryId = draft.categoryTouched ? draft.category_id : suggested;
  const suggestedByRule = Boolean(ruleMatch) && !draft.categoryTouched;

  if (!open) return null;

  const categoryName = (id) =>
    categoryDisplayName(
      categories.items.find((c) => c.id === id),
      t,
    );

  /**
   * The amount is the only thing required. A date left alone is today --
   * which is when nearly every manually-logged transaction happened --
   * and a blank note takes the category's name, or just "Expense" /
   * "Income" when there isn't one. Both used to be mandatory, which made
   * three fields stand between someone and logging the coffee they just
   * bought.
   */
  const addTransaction = async (e) => {
    e.preventDefault();
    if (draft.amount === '') return;
    // The Expense/Income toggle below is the one place the sign gets
    // decided -- the amount field only ever collects a plain positive
    // magnitude now, so there is nothing left to get backwards by typing
    // (or forgetting) a minus sign. See DirectionWarning.jsx for why that
    // used to be a real, easy-to-make mistake.
    //
    // Composing the stored amount is `budget_calc::signed_amount`, not a
    // ternary here, so that adding and editing cannot disagree about
    // which way round a number goes -- see the pre-fill effect above.
    if (!wasmModule?.signed_amount) return;
    const signed = await wasmModule.signed_amount({
      magnitude: Number(draft.amount),
      is_income: draft.isIncome,
    });
    if (signed?.error) {
      setSaveError(signed);
      return;
    }
    const fallback = categoryId
      ? categoryName(categoryId)
      : t(draft.isIncome ? 'transactions.income' : 'transactions.expense');
    await transactions.save({
      // Editing keeps the id, so the correction replaces the row rather
      // than leaving the original behind beside a near-duplicate.
      id: editing?.id ?? newId(),
      date: draft.date || today,
      description: draft.description.trim() || fallback,
      amount: signed.amount,
      category_id: categoryId || null,
    });
    setDraft({ ...EMPTY_DRAFT, isIncome: draft.isIncome });
    onClose();
  };

  /** A row counts as filled the moment it has an amount. The trailing
   *  empty row the form keeps ready is therefore free -- it is not a
   *  transaction, it is somewhere to type the next one. */
  const filledRows = rows.filter((r) => r.amount !== '' && Number(r.amount) > 0);

  const setRow = (key, patch) => {
    setRows((current) => {
      const next = current.map((r) => (r.key === key ? { ...r, ...patch } : r));
      // Typing an amount into the last row grows the form, so a batch
      // never needs a trip to "+ Add a row" between entries.
      const last = next[next.length - 1];
      return last.amount !== '' ? [...next, emptyRow(last.date)] : next;
    });
  };

  const addRow = () =>
    setRows((current) => [...current, emptyRow(current[current.length - 1].date)]);

  const removeRow = (key) =>
    setRows((current) => (current.length === 1 ? current : current.filter((r) => r.key !== key)));

  /**
   * Saves every filled row, and drops each one as it lands.
   *
   * Sequential, not `Promise.all`: `transactions.save` writes through
   * one storage handle, and a failure half way has to leave something
   * coherent behind. What is left in the sheet afterwards is exactly
   * what did not save, with the error above it -- a batch that silently
   * lost a row is the "quietly wrong" failure this app is built to
   * avoid.
   *
   * The sign comes from `budget_calc::signed_amount` per row, the same
   * call the single form makes. Nothing here decides a sign.
   */
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
    onClose();
  };

  /** "Add 3 transactions" once there is more than one row to file; a
   *  single row keeps the single form's sentence, which quotes the
   *  figure and the category back. */
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

  /** The other half of the correction loop: having just filed this one
   *  transaction, file every future one that looks like it. The keyword
   *  is whatever is in the field -- the suggestion is only a starting
   *  point, and a rule saved from a wrong guess would miscategorize
   *  every import from here on. */
  const saveRuleFromTransaction = async () => {
    const keyword = ruleKeyword.trim();
    if (!keyword || !categoryId) return;
    await rules.save({ id: newId(), keyword, category_id: categoryId, priority: 0 });
    setRuleSaved(keyword);
  };

  /** Names what is about to happen, with the figures already in the
   *  draft -- "Add $42.60 to Food" is a sentence someone can check
   *  before tapping, where "Add expense" is a button they have to trust.
   *  Falls back as the draft empties out, never naming a category or an
   *  amount that isn't there. */
  const submitLabel = () => {
    // Editing names the act, not the figures: "Add $42.60 to Food" is
    // worth quoting back because the row does not exist yet, but on a
    // correction the row is right there on the screen behind the sheet.
    if (editing) return t('transactions.saveChanges');
    if (draft.amount === '') {
      return t(draft.isIncome ? 'transactions.addIncome' : 'transactions.addExpense');
    }
    const amount = formatMoney(Math.abs(Number(draft.amount)));
    return categoryId
      ? t('transactions.addAmountTo', { amount, category: categoryName(categoryId) })
      : t('transactions.addAmount', { amount });
  };

  const addRecurring = async (e) => {
    e.preventDefault();
    if (!recurringDraft.description.trim() || !recurringDraft.category_id) return;
    if (!recurringDraft.amount || !recurringDraft.anchor_date) return;
    await recurring.save({
      id: newId(),
      description: recurringDraft.description,
      category_id: recurringDraft.category_id,
      amount: Number(recurringDraft.amount),
      cadence: recurringDraft.cadence,
      anchor_date: recurringDraft.anchor_date,
    });
    setRecurringDraft(EMPTY_RECURRING_DRAFT);
    onClose();
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-picked after a re-detect
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      setImportResult(null);
      // Most bank/card exports use a handful of common header names --
      // detecting from those means the common case needs no manual setup
      // at all. `mapping: null` means it couldn't confidently guess (an
      // unrecognized header, or no header at all), so this falls back to
      // the same manual defaults as before -- nothing is lost, the
      // "Adjust columns" panel below just opens on its own to prompt it.
      const detected = await wasmModule?.detect_csv_columns?.(text);
      if (detected?.mapping) {
        setMapping(detected.mapping);
        setColumnsDetected(true);
      } else {
        setMapping(DEFAULT_MAPPING);
        setColumnsDetected(false);
      }
    };
    reader.readAsText(file);
  };

  const runImport = async () => {
    if (!wasmModule?.import_csv || !csvText) return;
    const outcome = await wasmModule.import_csv({ csv_text: csvText, mapping });
    setImportResult(outcome);
    if (!outcome?.error) {
      for (const row of outcome.imported ?? []) {
        await transactions.save(row.transaction);
      }
    }
  };

  // Fills the ordinary manual form and switches back to it, rather than
  // saving directly -- see VoiceCapture.jsx's own doc comment for why: a
  // mis-transcribed word or a missed category should go through the same
  // review step every other entry method already requires, and this
  // keeps `transactions.save` called from exactly one place in this file.
  const onVoiceParsed = (patch) => {
    // Batch mode renders rows, not the draft, so a spoken transaction
    // has to land in a row or it would vanish on the way back to the
    // manual tab. It takes the first empty one -- the trailing row the
    // form always keeps ready -- and leaves any typed rows alone.
    if (batch) {
      const row = {
        date: patch.date,
        description: patch.description,
        amount: patch.amount === '' || patch.amount == null ? '' : String(patch.amount),
        category_id: patch.category_id,
        isIncome: patch.isIncome,
        categoryTouched: Boolean(patch.category_id),
      };
      setRows((current) => {
        const target = current.find((r) => r.amount === '');
        const next = target
          ? current.map((r) => (r.key === target.key ? { ...r, ...row } : r))
          : [...current, { ...emptyRow(patch.date), ...row }];
        const last = next[next.length - 1];
        return last.amount !== '' ? [...next, emptyRow(last.date)] : next;
      });
      setMethod('manual');
      return;
    }
    setDraft({
      date: patch.date,
      description: patch.description,
      amount: patch.amount,
      category_id: patch.category_id,
      isIncome: patch.isIncome,
      // A category heard in the utterance is the person's own answer,
      // not a guess to be overwritten by the ranking a moment later.
      categoryTouched: Boolean(patch.category_id),
    });
    setMethod('manual');
  };

  const closeAndReset = () => {
    setDraft(EMPTY_DRAFT);
    setRows([emptyRow()]);
    setRowRuleMatches({});
    setRecurringDraft(EMPTY_RECURRING_DRAFT);
    setSaveError(null);
    setRuleSaved(null);
    onClose();
  };

  // A batch is for entering new rows at a width that can show a table of
  // them. Correcting an existing transaction is one row, so it keeps the
  // single form; so does every non-manual method.
  const batch = isDesktop && !editing;

  const sheetTitle = editing ? t('transactions.editTitle') : t('transactions.addManual');

  return (
    <div className="add-txn-backdrop" role="presentation" onClick={closeAndReset}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- this handler only stops a click from reaching the backdrop's dismiss handler above; the panel itself is not something to activate, so there is no keyboard equivalent to add. Focus and Escape are handled by the dialog role. */}
      <div
        className={`add-txn-dialog${batch && method === 'manual' ? ' batch' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={sheetTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="add-txn-header">
          <span className="add-txn-title">{sheetTitle}</span>
          <button
            type="button"
            className="dash-month-btn"
            aria-label={t('monthpicker.close')}
            onClick={closeAndReset}
          >
            ×
          </button>
        </div>

        {/* No method row when correcting an existing transaction. A
            receipt scan, a voice note or a CSV import all create rows;
            none of them edits the one already on screen, so offering
            them here would be five tabs where four do nothing. */}
        {!editing && (
          <div className="add-txn-methods" role="tablist" aria-label={t('transactions.addManual')}>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'manual'}
              className={`add-txn-method-btn${method === 'manual' ? ' active' : ''}`}
              onClick={() => setMethod('manual')}
            >
              <PenIcon />
              <span>{t('transactions.methodManual')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'receipt'}
              className={`add-txn-method-btn${method === 'receipt' ? ' active' : ''}`}
              onClick={() => setMethod('receipt')}
            >
              <CameraIcon />
              <span>{t('transactions.methodReceipt')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'voice'}
              className={`add-txn-method-btn${method === 'voice' ? ' active' : ''}`}
              onClick={() => setMethod('voice')}
            >
              <MicIcon />
              <span>{t('transactions.methodVoice')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'csv'}
              className={`add-txn-method-btn${method === 'csv' ? ' active' : ''}`}
              onClick={() => setMethod('csv')}
            >
              <SpreadsheetIcon />
              <span>{t('transactions.methodImport')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'recurring'}
              className={`add-txn-method-btn${method === 'recurring' ? ' active' : ''}`}
              onClick={() => setMethod('recurring')}
            >
              <RecurringIcon />
              <span>{t('transactions.methodRecurring')}</span>
            </button>
          </div>
        )}

        <div className="add-txn-body">
          {/* Desktop logs a batch: several rows, one save, one sheet.
              Everything below this is the phone form, unchanged, and it
              is still what a correction uses at any width -- editing is
              one row by definition. */}
          {method === 'manual' && batch && (
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
          )}

          {method === 'manual' && !batch && (
            <>
              {/* The direction of money is decided once, here, rather than
                  by the amount field's sign -- see NumberField.jsx's own
                  doc comment for the mobile keyboard bug (no minus key on
                  at least one major browser) that made a signed amount
                  field an actual trap, not just a clarity complaint. Both
                  the submit label and the category list below follow this
                  choice, so nothing past this point asks for a sign. */}
              <div
                className="txn-type-toggle"
                role="tablist"
                aria-label={t('transactions.entryType')}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!draft.isIncome}
                  className={`txn-type-btn${!draft.isIncome ? ' active' : ''}`}
                  onClick={() =>
                    setDraft({ ...draft, isIncome: false, category_id: '', categoryTouched: false })
                  }
                >
                  {t('transactions.expense')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.isIncome}
                  className={`txn-type-btn${draft.isIncome ? ' active' : ''}`}
                  onClick={() =>
                    setDraft({ ...draft, isIncome: true, category_id: '', categoryTouched: false })
                  }
                >
                  {t('transactions.income')}
                </button>
              </div>
              {/* Amount first. It is the one thing someone always knows
                  when they open this sheet, the only required field, and
                  the thing every other control below reacts to -- the
                  submit button quotes it back. Date and note used to
                  come first purely because that is a bank statement's
                  column order. The Expense/Income toggle right above
                  already says which this is; a repeated "Recorded as
                  money spent" line under it was redundant, not a hint. */}
              <form className="form-grid" onSubmit={addTransaction}>
                <NumberField
                  label={t('transactions.amount')}
                  value={draft.amount}
                  onChange={(v) => setDraft({ ...draft, amount: v })}
                  grouped
                />
                <label className="field">
                  <span className="field-label">{t('transactions.description')}</span>
                  <div className="field-input">
                    <input
                      value={draft.description}
                      placeholder={t('transactions.descriptionPlaceholder')}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>
                </label>

                <CategoryPicker
                  ordered={ordered}
                  value={categoryId}
                  isIncome={draft.isIncome}
                  createCategory={createCategory}
                  onChange={(id) => setDraft({ ...draft, category_id: id, categoryTouched: true })}
                />
                {/* Says why a category is already selected, so an
                    unexpected one is something to correct rather than
                    something to wonder about. Only rules get a line:
                    "because you use it most" is not worth a sentence on
                    a sheet this size. */}
                {suggestedByRule && (
                  <p className="field-label">
                    {t('transactions.ruleMatched', { category: categoryName(ruleMatch) })}
                  </p>
                )}

                <label className="field">
                  <span className="field-label">{t('transactions.date')}</span>
                  <div className="field-input">
                    <input
                      type="date"
                      value={draft.date || today}
                      onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                    />
                  </div>
                </label>
                <div className="add-txn-submit-bar">
                  <button className="btn" type="submit" disabled={draft.amount === ''}>
                    {submitLabel()}
                  </button>
                </div>
              </form>

              {/* Closes the correction loop, and only where it makes
                  sense: right after someone has told the app where this
                  transaction belongs. `categoryTouched` is what makes
                  that "told" rather than "guessed" -- the picker always
                  has something selected, but until it is tapped that is
                  the ranking's suggestion, and a rule is durable enough
                  that seeding one from a guess would quietly misfile
                  every future import. Outside a form of its own: a
                  submit button nested in the one above would save the
                  transaction instead of the rule. */}
              {editing && categoryId && draft.categoryTouched && (
                <div className="add-txn-rule">
                  <h3 className="add-txn-rule-title">{t('transactions.makeRuleTitle')}</h3>
                  <p className="field-label">
                    {t('transactions.makeRuleHint', { category: categoryName(categoryId) })}
                  </p>
                  <label className="field">
                    <span className="field-label">{t('transactions.ruleKeyword')}</span>
                    <div className="field-input">
                      <input
                        value={ruleKeyword}
                        placeholder={t('transactions.makeRulePlaceholder')}
                        onChange={(e) => {
                          setRuleKeyword(e.target.value);
                          setRuleSaved(null);
                        }}
                      />
                    </div>
                  </label>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={!ruleKeyword.trim()}
                    onClick={saveRuleFromTransaction}
                  >
                    {t('transactions.makeRuleCta')}
                  </button>
                  {ruleSaved && (
                    <p className="field-label" role="status">
                      {t('transactions.makeRuleSaved', {
                        keyword: ruleSaved,
                        category: categoryName(categoryId),
                      })}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {method === 'receipt' && (
            <ReceiptCapture
              wasmModule={wasmModule}
              newId={newId}
              categories={categories}
              rules={rules}
              transactions={transactions}
              formatMoney={formatMoney}
            />
          )}

          {method === 'voice' && (
            <VoiceCapture
              wasmModule={wasmModule}
              categories={categories}
              onParsed={onVoiceParsed}
            />
          )}

          {method === 'csv' && (
            <>
              <p className="panel-subtitle">{t('transactions.importHint')}</p>
              <div className="form-grid">
                <label className="btn secondary">
                  <SpreadsheetIcon />
                  {t('transactions.chooseFile')}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={onFile}
                    className="visually-hidden"
                  />
                </label>
              </div>

              {csvText && (
                <p className="panel-subtitle">
                  {columnsDetected
                    ? t('transactions.columnsDetected')
                    : t('transactions.columnsNotDetected')}
                </p>
              )}

              {csvText && !columnsDetected && (
                <details className="csv-columns" open>
                  <summary>{t('transactions.mapColumns')}</summary>
                  <div className="form-grid">
                    <label className="field">
                      <span className="field-label">{t('transactions.dateColumn')}</span>
                      <div className="field-input">
                        <input
                          type="number"
                          min="0"
                          value={mapping.date_col}
                          onChange={(e) =>
                            setMapping({ ...mapping, date_col: Number(e.target.value) })
                          }
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span className="field-label">{t('transactions.descriptionColumn')}</span>
                      <div className="field-input">
                        <input
                          type="number"
                          min="0"
                          value={mapping.description_col}
                          onChange={(e) =>
                            setMapping({ ...mapping, description_col: Number(e.target.value) })
                          }
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span className="field-label">{t('transactions.amountColumn')}</span>
                      <div className="field-input">
                        <input
                          type="number"
                          min="0"
                          value={mapping.amount_col}
                          onChange={(e) =>
                            setMapping({ ...mapping, amount_col: Number(e.target.value) })
                          }
                        />
                      </div>
                    </label>
                    <label className="field field-check">
                      <input
                        type="checkbox"
                        checked={mapping.has_header}
                        onChange={(e) => setMapping({ ...mapping, has_header: e.target.checked })}
                      />
                      <span>{t('transactions.hasHeader')}</span>
                    </label>
                  </div>
                </details>
              )}

              <div className="form-grid">
                <button className="btn" type="button" onClick={runImport} disabled={!csvText}>
                  {t('transactions.import')}
                </button>
              </div>

              {importResult?.error && <CalcError result={importResult} />}
              {importResult && !importResult.error && (
                <p className="headline">
                  {t('transactions.importedCount', { count: importResult.imported?.length ?? 0 })}
                  {importResult.skipped?.length
                    ? ` · ${t('transactions.skippedCount', { count: importResult.skipped.length })}`
                    : ''}
                </p>
              )}
            </>
          )}

          {method === 'recurring' && (
            <>
              <form className="form-grid" onSubmit={addRecurring}>
                <label className="field">
                  <span className="field-label">{t('recurring.description')}</span>
                  <div className="field-input">
                    <input
                      value={recurringDraft.description}
                      onChange={(e) =>
                        setRecurringDraft({ ...recurringDraft, description: e.target.value })
                      }
                    />
                  </div>
                </label>
                <label className="field">
                  <span className="field-label">{t('transactions.category')}</span>
                  <select
                    className="field-select"
                    value={recurringDraft.category_id}
                    onChange={(e) =>
                      setRecurringDraft({ ...recurringDraft, category_id: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {categories.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryDisplayName(c, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField
                  label={t('recurring.amount')}
                  value={recurringDraft.amount}
                  onChange={(v) => setRecurringDraft({ ...recurringDraft, amount: v })}
                  grouped
                />
                <label className="field">
                  <span className="field-label">{t('recurring.cadence')}</span>
                  <select
                    className="field-select"
                    value={recurringDraft.cadence}
                    onChange={(e) =>
                      setRecurringDraft({ ...recurringDraft, cadence: e.target.value })
                    }
                  >
                    {CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {t(`freq.${c}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('recurring.anchorDate')}</span>
                  <div className="field-input">
                    <input
                      type="date"
                      value={recurringDraft.anchor_date}
                      onChange={(e) =>
                        setRecurringDraft({ ...recurringDraft, anchor_date: e.target.value })
                      }
                    />
                  </div>
                </label>
                <p className="field-label">{t('recurring.anchorHint')}</p>
                <div className="add-txn-submit-bar">
                  <button className="btn" type="submit">
                    {t('recurring.add')}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
        {saveError?.error && <CalcError result={saveError} />}
      </div>
    </div>
  );
}
