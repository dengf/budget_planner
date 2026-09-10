import React, { useState } from 'react';
import { useI18n } from '../i18n';
import {
  classifyStatementDescriptions,
  extractReceiptText,
  isPdf,
  smartParseReceiptFile,
  SMART_PARSE_APPROX_TOTAL_BYTES,
} from '../receiptCapture';
import CalcError from './CalcError';
import CameraCapture from './CameraCapture';
import DirectionWarning from './DirectionWarning';
import { PdfIcon } from './icons';
import NumberField from './NumberField';
import { categoryDisplayName } from '../presetCategories';

const EMPTY_DRAFT = { date: '', description: '', amount: '', category_id: '' };

// One decimal place is plenty for a download-progress readout -- nobody
// needs "2.10 GB" over "2.1 GB" here, and a byte-exact figure would just
// be noise given `SMART_PARSE_APPROX_TOTAL_BYTES` is itself an estimate.
function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

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
  // Opt-in, not a default -- see `transactions.smartParseHint`, shown
  // right next to this toggle: it names the ~2.2GB one-time download
  // before anyone turns it on, per CLAUDE.md's "never state something
  // that isn't true yet" -- there is no silent, surprise download here.
  const [smartParseEnabled, setSmartParseEnabled] = useState(false);
  // `{ phase: 'download', loadedBytes }` while Smart Parse's model is
  // still being fetched, `{ phase: 'page', page, totalPages }` while a
  // multi-page PDF is being rasterized and read one page at a time, or
  // `null` when there's nothing more specific to report than "reading".
  const [progress, setProgress] = useState(null);
  // Set when a PDF had more pages than `receiptCapture.js`'s per-import
  // cap -- shown once processing finishes, alongside whatever the capped
  // pass did manage to extract, rather than silently dropping pages.
  const [truncated, setTruncated] = useState(null);

  // Only rows `resolve_statement_amount` (Rust) had no sign, marker or
  // keyword to go on -- most statements never have any, so this usually
  // resolves to the input unchanged without ever loading the classifier.
  // A row the model couldn't classify (predicted `null`, e.g. the
  // ~23MB model failed to load) keeps the heuristic's existing
  // default-to-expense guess rather than blocking statement review on
  // it -- see `budget-wasm-llm`'s own doc comment for why that fallback
  // is low-stakes now.
  const classifyAmbiguousRows = async (rows) => {
    const ambiguous = rows.filter((r) => r.direction_is_guessed);
    if (ambiguous.length === 0) return rows;
    const predictions = await classifyStatementDescriptions(
      ambiguous.map((r) => r.description ?? ''),
    );
    let i = 0;
    return rows.map((r) => {
      if (!r.direction_is_guessed) return r;
      const predictedIncome = predictions[i++];
      if (predictedIncome === true) {
        return { ...r, amount: Math.abs(r.amount), is_income: true };
      }
      return r;
    });
  };

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
    setProgress(null);
    setTruncated(null);
    setStatus('reading');
    try {
      // Smart Parse reads pixels for a PDF too now (rasterizing each page
      // via `budget-wasm-pdfrender`), not just photographed receipts --
      // see `smartParseReceiptFile`'s own doc comment for why that's true
      // even for a PDF that already has a text layer.
      const {
        text,
        calcError: extractError,
        truncated: extractTruncated,
      } = smartParseEnabled
        ? await smartParseReceiptFile(file, setProgress)
        : await extractReceiptText(file, setProgress);
      setProgress(null); // done either way; nothing left to report
      if (extractError) {
        setCalcError(extractError);
        setStatus('idle');
        return;
      }
      if (extractTruncated) setTruncated(extractTruncated);

      if (isPdf(file)) {
        const statement = wasmModule.parse_statement_text(text);
        if ((statement?.rows?.length ?? 0) >= MIN_STATEMENT_ROWS) {
          const rows = await classifyAmbiguousRows(statement.rows);
          await startStatementReview(rows);
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
    } catch (error) {
      // Surfaced only to the console, not the user -- the toast below
      // stays generic and translated either way. Before this, a failure
      // here (a worker crash, a Smart Parse model-download error) left no
      // trace anywhere: this `catch` had no error parameter at all, so a
      // real iPhone report of this exact toast couldn't be diagnosed after
      // the fact even with Safari's remote Web Inspector open on a retry.
      console.error('Receipt extraction failed:', error);
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
        <>
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
          <label className="field field-check">
            <input
              type="checkbox"
              checked={smartParseEnabled}
              onChange={(e) => setSmartParseEnabled(e.target.checked)}
              disabled={status === 'reading'}
            />
            <span>{t('transactions.smartParseToggle')}</span>
          </label>
          {smartParseEnabled && (
            <p className="panel-subtitle">
              {t('transactions.smartParseHint', {
                size: formatBytes(SMART_PARSE_APPROX_TOTAL_BYTES),
              })}
            </p>
          )}
        </>
      )}

      {status === 'reading' && (
        <p className="empty-state">
          {progress?.phase === 'download' && progress.loadedBytes < SMART_PARSE_APPROX_TOTAL_BYTES
            ? t('transactions.smartParseDownloading', {
                percent: Math.min(
                  100,
                  Math.round((progress.loadedBytes / SMART_PARSE_APPROX_TOTAL_BYTES) * 100),
                ),
                loaded: formatBytes(progress.loadedBytes),
                total: formatBytes(SMART_PARSE_APPROX_TOTAL_BYTES),
              })
            : progress?.phase === 'page'
              ? t('transactions.receiptReadingPage', progress)
              : smartParseEnabled
                ? t('transactions.smartParseRunning')
                : t('transactions.receiptReading')}
        </p>
      )}
      {calcError && <CalcError result={calcError} />}
      {truncated && (
        <p className="panel-subtitle">{t('transactions.receiptPagesTruncated', truncated)}</p>
      )}

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
                      onChange={(e) => updateStatementRow(row.key, { category_id: e.target.value })}
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
