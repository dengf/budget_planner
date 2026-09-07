import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { extractReceiptText, isPdf } from '../receiptCapture';
import CalcError from './CalcError';
import CameraCapture from './CameraCapture';
import DirectionWarning from './DirectionWarning';
import { PdfIcon } from './icons';
import NumberField from './NumberField';
import { categoryDisplayName } from '../presetCategories';

const EMPTY_DRAFT = { date: '', description: '', amount: '', category_id: '' };

// A statement PDF (several transaction lines) needs at least two rows to
// be worth a bulk-review screen instead of the single-draft form below --
// one row is exactly what the single-receipt path already handles, and
// treating it as a "statement" would just be a worse UI for the same
// result. See `budget_calc::parse_statement_text`'s doc comment for why
// this is a separate Rust parser rather than a mode of `parse_receipt_text`.
const MIN_STATEMENT_ROWS = 2;

function statementRowKey(row, i) {
  return `${row.line}-${i}`;
}

/**
 * Adds a transaction from a photographed receipt or a PDF, instead of
 * typing it in by hand. Deliberately does not auto-save the way CSV
 * import does (`runImport` in `TransactionsTab.jsx`) -- OCR and a
 * receipt's inconsistent layout are both far less reliable than a bank's
 * own structured export, so every extracted field lands in this
 * pre-filled, fully editable form and nothing saves until "Add" is
 * pressed. See the receipt-capture plan addendum for the full design.
 */
export default function ReceiptCapture({
  wasmModule,
  newId,
  categories,
  rules,
  transactions,
  formatMoney,
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState('idle'); // idle | reading | review | statementReview
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [isIncomeHint, setIsIncomeHint] = useState(false);
  const [calcError, setCalcError] = useState(null);
  const [statementRows, setStatementRows] = useState([]);

  // One `apply_rules` call across every row instead of one per row --
  // same batching TransactionsTab's own "Apply rules" button already
  // does, just seeded from freshly-parsed drafts instead of saved
  // transactions.
  const startStatementReview = async (rows) => {
    const guesses = await wasmModule.apply_rules({
      transactions: rows.map((r, i) => ({
        id: `draft-${i}`,
        date: r.date,
        description: r.description ?? '',
        amount: r.amount,
        category_id: null,
      })),
      rules: rules.items,
    });
    setStatementRows(
      rows.map((r, i) => ({
        key: statementRowKey(r, i),
        include: true,
        date: r.date,
        description: r.description ?? '',
        amount: String(r.amount),
        category_id: guesses?.transactions?.[i]?.category_id ?? '',
      })),
    );
    setStatus('statementReview');
  };

  const handleFile = async (file) => {
    if (!file || !wasmModule) return;
    setCalcError(null);
    setStatus('reading');
    try {
      const { text, calcError: extractError } = await extractReceiptText(file);
      if (extractError) {
        setCalcError(extractError);
        setStatus('idle');
        return;
      }

      if (isPdf(file)) {
        const statement = wasmModule.parse_statement_text(text);
        if ((statement?.rows?.length ?? 0) >= MIN_STATEMENT_ROWS) {
          await startStatementReview(statement.rows);
          return;
        }
      }

      const parsed = wasmModule.parse_receipt_text(text);
      let category_id = '';
      if (parsed.description || parsed.amount != null) {
        const guess = await wasmModule.apply_rules({
          transactions: [
            {
              id: 'draft',
              date: parsed.date ?? '',
              description: parsed.description ?? '',
              amount: parsed.amount ?? 0,
              category_id: null,
            },
          ],
          rules: rules.items,
        });
        category_id = guess?.transactions?.[0]?.category_id ?? '';
      }

      setDraft({
        date: parsed.date ?? '',
        description: parsed.description ?? '',
        amount: parsed.amount != null ? String(parsed.amount) : '',
        category_id,
      });
      setIsIncomeHint(parsed.is_income);
      setStatus('review');
    } catch {
      setCalcError({ error: t('transactions.receiptExtractFailed') });
      setStatus('idle');
    }
  };

  const onPdfFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be re-picked after a discard
    handleFile(file);
  };

  const addFromReceipt = async (e) => {
    e.preventDefault();
    if (!draft.date || !draft.description || draft.amount === '') return;
    await transactions.save({
      id: newId(),
      date: draft.date,
      description: draft.description,
      amount: Number(draft.amount),
      category_id: draft.category_id || null,
    });
    setDraft(EMPTY_DRAFT);
    setStatus('idle');
  };

  const discard = () => {
    setDraft(EMPTY_DRAFT);
    setStatus('idle');
  };

  const updateStatementRow = (key, patch) => {
    setStatementRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const includedCount = statementRows.filter((r) => r.include).length;

  const addFromStatement = async (e) => {
    e.preventDefault();
    for (const row of statementRows) {
      if (!row.include || !row.date || row.amount === '') continue;
      await transactions.save({
        id: newId(),
        date: row.date,
        description: row.description,
        amount: Number(row.amount),
        category_id: row.category_id || null,
      });
    }
    setStatementRows([]);
    setStatus('idle');
  };

  const discardStatement = () => {
    setStatementRows([]);
    setStatus('idle');
  };

  return (
    <>
      <h2 className="section-start">{t('transactions.receiptTitle')}</h2>
      <p className="panel-subtitle">{t('transactions.receiptHint')}</p>

      {status !== 'review' && status !== 'statementReview' && (
        <div className="form-grid">
          <CameraCapture onFile={handleFile} />
          <label className="btn secondary">
            <PdfIcon />
            {t('transactions.uploadPdf')}
            <input
              type="file"
              accept="application/pdf"
              onChange={onPdfFile}
              className="visually-hidden"
            />
          </label>
        </div>
      )}

      {status === 'reading' && <p className="empty-state">{t('transactions.receiptReading')}</p>}
      {calcError && <CalcError result={calcError} />}

      {status === 'statementReview' && (
        <>
          <p className="panel-subtitle">
            {t('transactions.statementReviewHint', { count: statementRows.length })}
          </p>
          <form className="statement-rows" onSubmit={addFromStatement}>
            {statementRows.map((row) => (
              <div className="statement-row" key={row.key}>
                <label className="field field-check">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) => updateStatementRow(row.key, { include: e.target.checked })}
                  />
                  <span>{t('transactions.statementRowInclude')}</span>
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span className="field-label">{t('transactions.date')}</span>
                    <div className="field-input">
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => updateStatementRow(row.key, { date: e.target.value })}
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">{t('transactions.description')}</span>
                    <div className="field-input">
                      <input
                        value={row.description}
                        onChange={(e) =>
                          updateStatementRow(row.key, { description: e.target.value })
                        }
                      />
                    </div>
                  </label>
                  <NumberField
                    label={t('transactions.amount')}
                    value={row.amount}
                    onChange={(v) => updateStatementRow(row.key, { amount: v })}
                    grouped
                    signed
                  />
                  <label className="field">
                    <span className="field-label">{t('transactions.category')}</span>
                    <select
                      className="field-select"
                      value={row.category_id}
                      onChange={(e) =>
                        updateStatementRow(row.key, { category_id: e.target.value })
                      }
                    >
                      <option value="">{t('transactions.uncategorized')}</option>
                      {categories.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryDisplayName(c, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}
            <div className="form-grid">
              <button className="btn" type="submit" disabled={includedCount === 0}>
                {t('transactions.statementAddAll', { count: includedCount })}
              </button>
              <button className="btn secondary" type="button" onClick={discardStatement}>
                {t('confirm.cancel')}
              </button>
            </div>
          </form>
        </>
      )}

      {status === 'review' && (
        <>
          <p className="panel-subtitle">{t('transactions.receiptReviewHint')}</p>
          {isIncomeHint && <p className="panel-subtitle">{t('transactions.receiptIncomeHint')}</p>}
          <form className="form-grid" onSubmit={addFromReceipt}>
            <label className="field">
              <span className="field-label">{t('transactions.date')}</span>
              <div className="field-input">
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">{t('transactions.description')}</span>
              <div className="field-input">
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
            </label>
            <NumberField
              label={t('transactions.amount')}
              value={draft.amount}
              onChange={(v) => setDraft({ ...draft, amount: v })}
              grouped
              signed
            />
            <label className="field">
              <span className="field-label">{t('transactions.category')}</span>
              <select
                className="field-select"
                value={draft.category_id}
                onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}
              >
                <option value="">{t('transactions.uncategorized')}</option>
                {categories.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryDisplayName(c, t)}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">
              {t('transactions.add')}
            </button>
            <button className="btn secondary" type="button" onClick={discard}>
              {t('confirm.cancel')}
            </button>
          </form>
          <DirectionWarning
            amount={draft.amount}
            category={categories.items.find((c) => c.id === draft.category_id)}
            formatMoney={formatMoney}
            onUseFlipped={(flipped) => setDraft({ ...draft, amount: String(flipped) })}
          />
        </>
      )}
    </>
  );
}
