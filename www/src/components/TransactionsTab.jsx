import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthLabel } from '../month';
import AddTransactionSheet from './AddTransactionSheet';
import CategoryBadge from './CategoryBadge';
import MonthYearPicker from './MonthYearPicker';
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

  const [ruleDraft, setRuleDraft] = useState({ keyword: '', category_id: '', priority: 0 });

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
        recurring={recurring}
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

      <h2 className="section-start">{t('recurring.title')}</h2>
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
