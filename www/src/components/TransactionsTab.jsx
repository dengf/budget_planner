import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthLabel } from '../month';
import AddTransactionSheet from './AddTransactionSheet';
import CategoryBadge from './CategoryBadge';
import MonthYearPicker from './MonthYearPicker';
import { categoryDisplayName } from '../presetCategories';
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
  const [addMethod, setAddMethod] = useState('manual');

  /** Opens the Add sheet on a specific tab -- the empty state's two
   *  buttons (Log a transaction / Import CSV) both go through this
   *  rather than always landing on Manual, since a "Import CSV" button
   *  that opens onto the Manual form would read as broken. */
  const openAdd = (method = 'manual') => {
    setAddMethod(method);
    setAddOpen(true);
  };

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
  const categoryName = (id) => {
    const c = categoryFor(id);
    return c ? categoryDisplayName(c, t) : t('transactions.uncategorized');
  };

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
          onClick={() => openAdd('manual')}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <AddTransactionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        initialMethod={addMethod}
        wasmModule={wasmModule}
        newId={newId}
        categories={categories}
        rules={rules}
        transactions={transactions}
        recurring={recurring}
        formatMoney={formatMoney}
      />

      {/* Logging and importing are what a first-time (and every later)
          visit to this tab is actually for -- categorization rules and
          recurring setup below are real, useful features, but neither one
          means anything before a transaction history exists to apply
          them to. Putting the transaction list, and its two loudest ways
          to start one, ahead of both is what makes that order obvious
          instead of the opposite of what actually happens: rules and
          recurring used to render first, above an empty list they had
          nothing to act on yet. */}
      {transactions.items.length === 0 ? (
        <>
          <h2 className="section-start">{t('transactions.listTitle')}</h2>
          <div className="txn-empty-state">
            <p className="empty-state">{t('transactions.noTransactions')}</p>
            <div className="txn-empty-actions">
              <button type="button" className="btn" onClick={() => openAdd('manual')}>
                {t('transactions.logCta')}
              </button>
              <button type="button" className="btn secondary" onClick={() => openAdd('csv')}>
                {t('transactions.methodImport')}
              </button>
            </div>
          </div>
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

      {/* Rules and recurring setup: real features, kept out of the way
          until someone goes looking for them -- collapsed by default,
          same disclosure pattern as Budget's own collapsible sections. */}
      <details className="collapsible-panel">
        <summary>{t('transactions.rulesTitle')}</summary>
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
                  {categoryDisplayName(c, t)}
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
      </details>

      <details className="collapsible-panel">
        <summary>{t('recurring.title')}</summary>
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
      </details>
    </div>
  );
}
