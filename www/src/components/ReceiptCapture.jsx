import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { extractReceiptText } from '../receiptCapture';
import CalcError from './CalcError';
import CameraCapture from './CameraCapture';
import { PdfIcon } from './icons';
import NumberField from './NumberField';

const EMPTY_DRAFT = { date: '', description: '', amount: '', category_id: '' };

/**
 * Adds a transaction from a photographed receipt or a PDF, instead of
 * typing it in by hand. Deliberately does not auto-save the way CSV
 * import does (`runImport` in `TransactionsTab.jsx`) -- OCR and a
 * receipt's inconsistent layout are both far less reliable than a bank's
 * own structured export, so every extracted field lands in this
 * pre-filled, fully editable form and nothing saves until "Add" is
 * pressed. See the receipt-capture plan addendum for the full design.
 */
export default function ReceiptCapture({ wasmModule, newId, categories, rules, transactions }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('idle'); // idle | reading | review
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [isIncomeHint, setIsIncomeHint] = useState(false);
  const [calcError, setCalcError] = useState(null);

  const handleFile = async (file) => {
    if (!file || !wasmModule) return;
    setCalcError(null);
    setStatus('reading');
    try {
      const { text, calcError: extractError } = await extractReceiptText(wasmModule, file);
      if (extractError) {
        setCalcError(extractError);
        setStatus('idle');
        return;
      }

      const parsed = await wasmModule.parse_receipt_text(text);
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

  return (
    <>
      <h2 className="section-start">{t('transactions.receiptTitle')}</h2>
      <p className="panel-subtitle">{t('transactions.receiptHint')}</p>

      {status !== 'review' && (
        <div className="form-grid">
          <CameraCapture onFile={handleFile} />
          <label className="btn secondary">
            <PdfIcon />
            {t('transactions.uploadPdf')}
            <input type="file" accept="application/pdf" onChange={onPdfFile} className="visually-hidden" />
          </label>
        </div>
      )}

      {status === 'reading' && <p className="empty-state">{t('transactions.receiptReading')}</p>}
      {calcError && <CalcError result={calcError} />}

      {status === 'review' && (
        <>
          <p className="panel-subtitle">{t('transactions.receiptReviewHint')}</p>
          {isIncomeHint && <p className="panel-subtitle">{t('transactions.receiptIncomeHint')}</p>}
          <form className="form-grid" onSubmit={addFromReceipt}>
            <label className="field">
              <span className="field-label">{t('transactions.date')}</span>
              <div className="field-input">
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </div>
            </label>
            <label className="field">
              <span className="field-label">{t('transactions.description')}</span>
              <div className="field-input">
                <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
            </label>
            <NumberField
              label={t('transactions.amount')}
              value={draft.amount}
              onChange={(v) => setDraft({ ...draft, amount: v })}
              grouped
            />
            <label className="field">
              <span className="field-label">{t('transactions.category')}</span>
              <select className="field-select" value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                <option value="">{t('transactions.uncategorized')}</option>
                {categories.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="btn" type="submit">{t('transactions.add')}</button>
            <button className="btn secondary" type="button" onClick={discard}>{t('confirm.cancel')}</button>
          </form>
        </>
      )}
    </>
  );
}
