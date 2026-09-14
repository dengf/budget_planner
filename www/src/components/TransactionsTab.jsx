import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthLabel } from '../month';
import CategoryBadge from './CategoryBadge';
import MonthYearPicker from './MonthYearPicker';
import { makeCategoryLookup } from '../presetCategories';

/**
 * The transaction list, and nothing else.
 *
 * Two collapsed <details> used to sit under it -- categorization rules
 * and recurring expenses. Both are setup: written once, then working
 * quietly on every transaction added afterwards. They now live in More,
 * next to Goals and Debt, which leaves this tab as the one thing its
 * name promises. See RulesSection.jsx / RecurringSection.jsx.
 */
export default function TransactionsTab({
  currencySymbol,
  today,
  viewMonth,
  setViewMonth,
  confirm,
  categories,
  transactions,
  onOpenAdd,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [showAllMonths, setShowAllMonths] = useState(false);

  /** Opens the shell's Add sheet on a specific tab -- the empty state's
   *  two buttons (Log a transaction / Import CSV) both go through this
   *  rather than always landing on Manual, since an "Import CSV" button
   *  that opens onto the Manual form would read as broken.
   *
   *  The sheet itself lives in AppShell, behind the "+" in the nav bar,
   *  so it opens the same way from every tab instead of this tab owning
   *  a second copy of it. */
  const openAdd = (method = 'manual') => onOpenAdd?.(method);

  const { categoryFor, categoryName } = makeCategoryLookup(categories.items, t);

  const removeTransaction = async (tx) => {
    const ok = await confirm(t('confirm.removeTransaction', { description: tx.description }));
    if (ok) await transactions.remove(tx.id);
  };

  // Defaults to the viewed month so the list stays short and fast to scan
  // as history accumulates; "show all" is one click away for anyone
  // reconciling further back.
  const visibleTransactions = showAllMonths
    ? transactions.items
    : transactions.items.filter((tx) => tx.date?.startsWith(viewMonth));

  return (
    <div className="panel txn-panel">
      {/* No "+" in this header any more. It used to sit here, at the top
          of the screen -- the furthest point from a thumb on a tall
          phone, for the action taken most often in the whole app, and
          present on this tab only. It is now the centre button of the
          nav bar, within reach on every tab. */}
      <div className="dash-header sticky-title-header sticky-title-header-flush">
        <h2>{t('transactions.title')}</h2>
      </div>

      {/* Logging and importing are what a first visit to this tab is
          actually for, so the empty state leads with both rather than
          leaving someone to find the "+" on their own. */}
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
    </div>
  );
}
