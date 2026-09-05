import React, { useState } from 'react';
import { useI18n } from '../i18n';
import CalcError from './CalcError';
import DirectionWarning from './DirectionWarning';
import NumberField from './NumberField';
import ReceiptCapture from './ReceiptCapture';
import { SpreadsheetIcon } from './icons';

const DEFAULT_MAPPING = {
  date_col: 0,
  description_col: 1,
  amount_col: 2,
  credit_col: null,
  has_header: true,
};

const EMPTY_DRAFT = { date: '', description: '', amount: '', category_id: '' };

/**
 * The three ways a transaction enters the app -- manual entry, a
 * photographed/PDF receipt, a bank CSV export -- collapsed behind one
 * floating "Add" button (TransactionsTab.jsx) instead of three
 * permanently-expanded sections stacked above the transaction list.
 * Manual is the default tab: it needs no file and no OCR wait, the
 * quickest path for the single most common case of logging one thing
 * just spent. Closes itself after a manual add (a genuine one-shot
 * action); receipt and CSV import stay open afterward since scanning a
 * second receipt or re-running an import with adjusted columns are both
 * real, common follow-ups.
 */
export default function AddTransactionSheet({
  open,
  onClose,
  wasmModule,
  newId,
  categories,
  rules,
  transactions,
  formatMoney,
}) {
  const { t } = useI18n();
  const [method, setMethod] = useState('manual'); // 'manual' | 'receipt' | 'csv'

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [csvText, setCsvText] = useState('');
  const [mapping, setMapping] = useState(DEFAULT_MAPPING);
  const [columnsDetected, setColumnsDetected] = useState(false);
  const [importResult, setImportResult] = useState(null);

  if (!open) return null;

  const addTransaction = async (e) => {
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

  const closeAndReset = () => {
    setDraft(EMPTY_DRAFT);
    onClose();
  };

  return (
    <div className="add-txn-backdrop" role="presentation" onClick={closeAndReset}>
      <div
        className="add-txn-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('transactions.addManual')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="add-txn-header">
          <span className="add-txn-title">{t('transactions.addManual')}</span>
          <button
            type="button"
            className="dash-month-btn"
            aria-label={t('monthpicker.close')}
            onClick={closeAndReset}
          >
            ×
          </button>
        </div>

        <div className="add-txn-methods" role="tablist" aria-label={t('transactions.addManual')}>
          <button
            type="button"
            role="tab"
            aria-selected={method === 'manual'}
            className={`add-txn-method-btn${method === 'manual' ? ' active' : ''}`}
            onClick={() => setMethod('manual')}
          >
            {t('transactions.methodManual')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === 'receipt'}
            className={`add-txn-method-btn${method === 'receipt' ? ' active' : ''}`}
            onClick={() => setMethod('receipt')}
          >
            {t('transactions.methodReceipt')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === 'csv'}
            className={`add-txn-method-btn${method === 'csv' ? ' active' : ''}`}
            onClick={() => setMethod('csv')}
          >
            {t('transactions.methodImport')}
          </button>
        </div>

        <div className="add-txn-body">
          {method === 'manual' && (
            <>
              <form className="form-grid" onSubmit={addTransaction}>
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
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn" type="submit">
                  {t('transactions.add')}
                </button>
              </form>
              <p className="field-label">{t('transactions.amountHint')}</p>
              <DirectionWarning
                amount={draft.amount}
                category={categories.items.find((c) => c.id === draft.category_id)}
                formatMoney={formatMoney}
                onUseFlipped={(flipped) => setDraft({ ...draft, amount: String(flipped) })}
              />
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
        </div>
      </div>
    </div>
  );
}
