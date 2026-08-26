import React, { useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { currentMonth } from '../month';
import CalcError from './CalcError';
import NumberField from './NumberField';

const DEFAULT_MAPPING = { date_col: 0, description_col: 1, amount_col: 2, credit_col: null, has_header: true };

const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

export default function TransactionsTab({
  wasmModule,
  region,
  newId,
  confirm,
  categories,
  transactions,
  rules,
  recurring,
}) {
  const { t } = useI18n();
  const formatMoney = makeFormatMoney(region);
  const thisMonth = useMemo(() => currentMonth(), []);
  const [showAllMonths, setShowAllMonths] = useState(false);

  const [draft, setDraft] = useState({ date: '', description: '', amount: '', category_id: '' });
  const [csvText, setCsvText] = useState('');
  const [mapping, setMapping] = useState(DEFAULT_MAPPING);
  const [importResult, setImportResult] = useState(null);
  const [ruleDraft, setRuleDraft] = useState({ keyword: '', category_id: '', priority: 0 });
  const [recurringDraft, setRecurringDraft] = useState({
    description: '',
    category_id: '',
    amount: '',
    cadence: 'monthly',
    anchor_date: '',
  });

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
    setDraft({ date: '', description: '', amount: '', category_id: '' });
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const runImport = async (e) => {
    e.preventDefault();
    if (!wasmModule?.import_csv || !csvText) return;
    const outcome = await wasmModule.import_csv({ csv_text: csvText, mapping });
    setImportResult(outcome);
    if (!outcome?.error) {
      for (const row of outcome.imported ?? []) {
        await transactions.save(row.transaction);
      }
    }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!ruleDraft.keyword.trim() || !ruleDraft.category_id) return;
    await rules.save({ id: newId(), keyword: ruleDraft.keyword, category_id: ruleDraft.category_id, priority: Number(ruleDraft.priority) || 0 });
    setRuleDraft({ keyword: '', category_id: '', priority: 0 });
  };

  const applyRules = async () => {
    if (!wasmModule?.apply_rules) return;
    const result = await wasmModule.apply_rules({ transactions: transactions.items, rules: rules.items });
    if (!result?.error) {
      for (const tx of result.transactions) {
        const before = transactions.items.find((t) => t.id === tx.id);
        if (before?.category_id !== tx.category_id) await transactions.save(tx);
      }
    }
  };

  const categoryName = (id) => categories.items.find((c) => c.id === id)?.name ?? t('transactions.uncategorized');

  const removeTransaction = async (tx) => {
    const ok = await confirm(t('confirm.removeTransaction', { description: tx.description }));
    if (ok) await transactions.remove(tx.id);
  };

  const removeRule = async (rule) => {
    const ok = await confirm(t('confirm.removeRule', { keyword: rule.keyword }));
    if (ok) await rules.remove(rule.id);
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
    setRecurringDraft({ description: '', category_id: '', amount: '', cadence: 'monthly', anchor_date: '' });
  };

  const removeRecurring = async (item) => {
    const ok = await confirm(t('confirm.removeRecurring', { description: item.description }));
    if (ok) await recurring.remove(item.id);
  };

  // Defaults to the current month so the list stays short and fast to scan
  // as history accumulates; "show all" is one click away for anyone
  // reconciling further back.
  const visibleTransactions = showAllMonths
    ? transactions.items
    : transactions.items.filter((tx) => tx.date?.startsWith(thisMonth));

  return (
    <div className="panel">
      <h2>{t('transactions.title')}</h2>

      {transactions.items.length === 0 ? (
        <p className="empty-state">{t('transactions.noTransactions')}</p>
      ) : (
        <>
          <label className="field field-check">
            <input type="checkbox" checked={showAllMonths} onChange={(e) => setShowAllMonths(e.target.checked)} />
            <span>{t('transactions.showAllMonths')}</span>
          </label>
          {visibleTransactions.length === 0 ? (
            <p className="empty-state">{t('transactions.noneThisMonth')}</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>{t('transactions.date')}</th>
                  <th>{t('transactions.description')}</th>
                  <th>{t('transactions.category')}</th>
                  <th>{t('transactions.amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...visibleTransactions]
                  .sort((a, b) => (a.date < b.date ? 1 : -1))
                  .map((tx) => (
                    <tr key={tx.id}>
                      <td>{tx.date}</td>
                      <td>{tx.description}</td>
                      <td>{categoryName(tx.category_id)}</td>
                      <td className={`num ${tx.amount < 0 ? 'negative' : 'positive'}`}>{formatMoney(tx.amount)}</td>
                      <td>
                        <button className="btn ghost" onClick={() => removeTransaction(tx)}>{t('budget.remove')}</button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <form className="form-grid" onSubmit={addTransaction}>
        <label className="field">
          <span className="field-label">{t('transactions.date')}</span>
          <div className="field-input"><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.description')}</span>
          <div className="field-input"><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
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
      </form>
      <p className="field-label">{t('transactions.amountHint')}</p>

      <h2>{t('transactions.importTitle')}</h2>
      <p className="panel-subtitle">{t('transactions.importHint')}</p>
      <form onSubmit={runImport} className="form-grid">
        <label className="field">
          <span className="field-label">{t('transactions.chooseFile')}</span>
          <input type="file" accept=".csv,text/csv" onChange={onFile} />
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.dateColumn')}</span>
          <div className="field-input"><input type="number" min="0" value={mapping.date_col} onChange={(e) => setMapping({ ...mapping, date_col: Number(e.target.value) })} /></div>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.descriptionColumn')}</span>
          <div className="field-input"><input type="number" min="0" value={mapping.description_col} onChange={(e) => setMapping({ ...mapping, description_col: Number(e.target.value) })} /></div>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.amountColumn')}</span>
          <div className="field-input"><input type="number" min="0" value={mapping.amount_col} onChange={(e) => setMapping({ ...mapping, amount_col: Number(e.target.value) })} /></div>
        </label>
        <label className="field field-check">
          <input type="checkbox" checked={mapping.has_header} onChange={(e) => setMapping({ ...mapping, has_header: e.target.checked })} />
          <span>{t('transactions.hasHeader')}</span>
        </label>
        <button className="btn" type="submit" disabled={!csvText}>{t('transactions.import')}</button>
      </form>

      {importResult?.error && <CalcError result={importResult} />}
      {importResult && !importResult.error && (
        <p className="headline">
          {t('transactions.importedCount', { count: importResult.imported?.length ?? 0 })}
          {importResult.skipped?.length ? ` · ${t('transactions.skippedCount', { count: importResult.skipped.length })}` : ''}
        </p>
      )}

      <h2>{t('transactions.rulesTitle')}</h2>
      <p className="panel-subtitle">{t('transactions.rulesHint')}</p>
      {rules.items.length === 0 ? (
        <p className="empty-state">{t('transactions.noRules')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('transactions.ruleKeyword')}</th>
              <th>{t('transactions.category')}</th>
              <th>{t('transactions.rulePriority')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.items.map((r) => (
              <tr key={r.id}>
                <td>{r.keyword}</td>
                <td>{categoryName(r.category_id)}</td>
                <td className="num">{r.priority}</td>
                <td><button className="btn ghost" onClick={() => removeRule(r)}>{t('budget.remove')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="form-grid" onSubmit={addRule}>
        <label className="field">
          <span className="field-label">{t('transactions.ruleKeyword')}</span>
          <div className="field-input"><input value={ruleDraft.keyword} onChange={(e) => setRuleDraft({ ...ruleDraft, keyword: e.target.value })} /></div>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.category')}</span>
          <select className="field-select" value={ruleDraft.category_id} onChange={(e) => setRuleDraft({ ...ruleDraft, category_id: e.target.value })}>
            <option value="">—</option>
            {categories.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.rulePriority')}</span>
          <div className="field-input"><input type="number" value={ruleDraft.priority} onChange={(e) => setRuleDraft({ ...ruleDraft, priority: e.target.value })} /></div>
        </label>
        <button className="btn" type="submit">{t('transactions.addRule')}</button>
        <button className="btn secondary" type="button" onClick={applyRules}>{t('transactions.applyRules')}</button>
      </form>

      <h2>{t('recurring.title')}</h2>
      <p className="panel-subtitle">{t('recurring.hint')}</p>
      {recurring.items.length === 0 ? (
        <p className="empty-state">{t('recurring.none')}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>{t('recurring.description')}</th>
              <th>{t('transactions.category')}</th>
              <th>{t('budget.planned')}</th>
              <th>{t('recurring.cadence')}</th>
              <th>{t('recurring.anchorDate')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recurring.items.map((r) => (
              <tr key={r.id}>
                <td>{r.description}</td>
                <td>{categoryName(r.category_id)}</td>
                <td className="num">{formatMoney(r.amount)}</td>
                <td>{t(`freq.${r.cadence}`)}</td>
                <td>{r.anchor_date}</td>
                <td><button className="btn ghost" onClick={() => removeRecurring(r)}>{t('budget.remove')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="form-grid" onSubmit={addRecurring}>
        <label className="field">
          <span className="field-label">{t('recurring.description')}</span>
          <div className="field-input">
            <input
              value={recurringDraft.description}
              onChange={(e) => setRecurringDraft({ ...recurringDraft, description: e.target.value })}
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.category')}</span>
          <select
            className="field-select"
            value={recurringDraft.category_id}
            onChange={(e) => setRecurringDraft({ ...recurringDraft, category_id: e.target.value })}
          >
            <option value="">—</option>
            {categories.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
            onChange={(e) => setRecurringDraft({ ...recurringDraft, cadence: e.target.value })}
          >
            {CADENCES.map((c) => <option key={c} value={c}>{t(`freq.${c}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('recurring.anchorDate')}</span>
          <div className="field-input">
            <input
              type="date"
              value={recurringDraft.anchor_date}
              onChange={(e) => setRecurringDraft({ ...recurringDraft, anchor_date: e.target.value })}
            />
          </div>
        </label>
        <button className="btn" type="submit">{t('recurring.add')}</button>
      </form>
      <p className="field-label">{t('recurring.anchorHint')}</p>
    </div>
  );
}
