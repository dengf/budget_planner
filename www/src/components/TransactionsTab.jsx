import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthLabel } from '../month';
import AddTransactionSheet from './AddTransactionSheet';
import CategoryBadge from './CategoryBadge';
import MonthYearPicker from './MonthYearPicker';
import NumberField from './NumberField';

const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

export default function TransactionsTab({
  wasmModule,
  currencySymbol,
  today,
  viewMonth,
  setViewMonth,
  newId,
  confirm,
  categories,
  transactions,
  rules,
  recurring,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const [recurringFormOpen, setRecurringFormOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState({ keyword: '', category_id: '', priority: 0 });
  const [recurringDraft, setRecurringDraft] = useState({
    description: '',
    category_id: '',
    amount: '',
    cadence: 'monthly',
    anchor_date: '',
  });

  const addRule = async (e) => {
    e.preventDefault();
    if (!ruleDraft.keyword.trim() || !ruleDraft.category_id) return;
    await rules.save({
      id: newId(),
      keyword: ruleDraft.keyword,
      category_id: ruleDraft.category_id,
      priority: Number(ruleDraft.priority) || 0,
    });
    setRuleDraft({ keyword: '', category_id: '', priority: 0 });
  };

  const applyRules = async () => {
    if (!wasmModule?.apply_rules) return;
    const result = await wasmModule.apply_rules({
      transactions: transactions.items,
      rules: rules.items,
    });
    if (!result?.error) {
      for (const tx of result.transactions) {
        const before = transactions.items.find((t) => t.id === tx.id);
        if (before?.category_id !== tx.category_id) await transactions.save(tx);
      }
    }
  };

  const categoryFor = (id) => categories.items.find((c) => c.id === id);
  const categoryName = (id) =>
    categories.items.find((c) => c.id === id)?.name ?? t('transactions.uncategorized');

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
    setRecurringDraft({
      description: '',
      category_id: '',
      amount: '',
      cadence: 'monthly',
      anchor_date: '',
    });
  };

  const removeRecurring = async (item) => {
    const ok = await confirm(t('confirm.removeRecurring', { description: item.description }));
    if (ok) await recurring.remove(item.id);
  };

  // Defaults to the viewed month so the list stays short and fast to scan
  // as history accumulates; "show all" is one click away for anyone
  // reconciling further back.
  const visibleTransactions = showAllMonths
    ? transactions.items
    : transactions.items.filter((tx) => tx.date?.startsWith(viewMonth));

  return (
    <div className="panel txn-panel">
      <div className="dash-header sticky-title-header sticky-title-header-flush">
        <h2>{t('transactions.title')}</h2>
        <button
          type="button"
          className="icon-add-btn"
          aria-label={t('budget.logTransaction')}
          onClick={() => setAddOpen(true)}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <AddTransactionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        wasmModule={wasmModule}
        newId={newId}
        categories={categories}
        rules={rules}
        transactions={transactions}
        formatMoney={formatMoney}
      />

      <h2 className="section-start">{t('transactions.rulesTitle')}</h2>
      <p className="panel-subtitle">{t('transactions.rulesHint')}</p>
      {rules.items.length === 0 ? (
        <p className="empty-state">{t('transactions.noRules')}</p>
      ) : (
        <div className="table-scroll">
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
                  <td>
                    <span className="category-cell">
                      <CategoryBadge category={categoryFor(r.category_id)} />
                      {categoryName(r.category_id)}
                    </span>
                  </td>
                  <td className="num">{r.priority}</td>
                  <td>
                    <button className="btn ghost" onClick={() => removeRule(r)}>
                      {t('budget.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="form-grid" onSubmit={addRule}>
        <label className="field">
          <span className="field-label">{t('transactions.ruleKeyword')}</span>
          <div className="field-input">
            <input
              value={ruleDraft.keyword}
              onChange={(e) => setRuleDraft({ ...ruleDraft, keyword: e.target.value })}
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.category')}</span>
          <select
            className="field-select"
            value={ruleDraft.category_id}
            onChange={(e) => setRuleDraft({ ...ruleDraft, category_id: e.target.value })}
          >
            <option value="">—</option>
            {categories.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.rulePriority')}</span>
          <div className="field-input">
            <input
              type="number"
              value={ruleDraft.priority}
              onChange={(e) => setRuleDraft({ ...ruleDraft, priority: e.target.value })}
            />
          </div>
        </label>
        <button className="btn" type="submit">
          {t('transactions.addRule')}
        </button>
        <button className="btn secondary" type="button" onClick={applyRules}>
          {t('transactions.applyRules')}
        </button>
      </form>

      <div className="dash-header sticky-title-header section-start">
        <h2>{t('recurring.title')}</h2>
        <button
          type="button"
          className="icon-add-btn"
          aria-expanded={recurringFormOpen}
          aria-label={t('recurring.add')}
          onClick={() => setRecurringFormOpen((open) => !open)}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <p className="panel-subtitle">{t('recurring.hint')}</p>
      {recurring.items.length === 0 ? (
        <p className="empty-state">{t('recurring.none')}</p>
      ) : (
        <div className="table-scroll">
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
                  <td>
                    <span className="category-cell">
                      <CategoryBadge category={categoryFor(r.category_id)} />
                      {categoryName(r.category_id)}
                    </span>
                  </td>
                  <td className="num">{formatMoney(r.amount)}</td>
                  <td>{t(`freq.${r.cadence}`)}</td>
                  <td>{r.anchor_date}</td>
                  <td>
                    <button className="btn ghost" onClick={() => removeRecurring(r)}>
                      {t('budget.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recurringFormOpen && (
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
                    {c.name}
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
                onChange={(e) => setRecurringDraft({ ...recurringDraft, cadence: e.target.value })}
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
            <button className="btn" type="submit">
              {t('recurring.add')}
            </button>
          </form>
          <p className="field-label">{t('recurring.anchorHint')}</p>
        </>
      )}

      {transactions.items.length === 0 ? (
        <>
          <h2 className="section-start">{t('transactions.listTitle')}</h2>
          <p className="empty-state">{t('transactions.noTransactions')}</p>
        </>
      ) : (
        <>
          <div className="dash-header transactions-month-header">
            <h2 className="section-start">{t('transactions.listTitle')}</h2>
            {/* Kept interactive (not disabled) while "all months" is
                checked -- picking a month here still narrows the list back
                down the moment "all months" is unchecked. */}
            <div className={showAllMonths ? 'transactions-picker-dimmed' : ''}>
              <MonthYearPicker
                value={viewMonth}
                onChange={setViewMonth}
                todayMonth={today}
                locale={locale}
              />
            </div>
          </div>
          <label className="field field-check">
            <input
              type="checkbox"
              checked={showAllMonths}
              onChange={(e) => setShowAllMonths(e.target.checked)}
            />
            <span>{t('transactions.showAllMonths')}</span>
          </label>
          {visibleTransactions.length === 0 ? (
            <p className="empty-state">
              {showAllMonths
                ? t('transactions.noTransactions')
                : t('transactions.noneInMonth', { month: monthLabel(viewMonth, locale) })}
            </p>
          ) : (
            <ul className="txn-list">
              {[...visibleTransactions]
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .map((tx) => (
                  <li className="txn-card money-card" key={tx.id}>
                    <CategoryBadge category={categoryFor(tx.category_id)} />
                    <div className="txn-info">
                      <div className="txn-description">{tx.description}</div>
                      <div className="txn-meta">
                        {tx.date} · {categoryName(tx.category_id)}
                      </div>
                    </div>
                    <div className="txn-trailing">
                      <span className={`num txn-amount ${tx.amount < 0 ? 'negative' : 'positive'}`}>
                        {formatMoney(tx.amount)}
                      </span>
                      <button
                        className="btn ghost txn-remove"
                        onClick={() => removeTransaction(tx)}
                      >
                        {t('budget.remove')}
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
