import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { daysInMonth, monthLabel } from '../month';
import { loadIncome } from '../income';
import { EXPORT_FORMAT } from '../backup';
import { looksLikeAddress, mailtoUrl, parseRecipients } from '../mailto';
import PieChart from './PieChart';
import SpendOverTimeChart from './SpendOverTimeChart';
import MonthYearPicker from './MonthYearPicker';
import { SAVINGS_CATEGORY_ID, totalExpenseActual } from '../savings';

/**
 * The landing tab: this month's headline numbers first, the full
 * category table and export/import tools below. `viewMonth` is shared
 * app-wide (App.jsx) -- paging Dashboard back to a prior month is the
 * same month Budget/Transactions land on too. `budgetPlan.items` already
 * tracks `viewMonth` (App.jsx fetches it keyed by `viewMonth`), so this
 * tab reads it directly rather than keeping its own copy. Print, email
 * and export still describe `today`, the real current month (see their
 * own comments below) -- unlike everything else on this tab, those
 * describe *this* month regardless of what's being browsed.
 */
export default function DashboardTab({
  wasmModule,
  currencySymbol,
  today,
  viewMonth,
  setViewMonth,
  categories,
  transactions,
  rules,
  budgetPlan,
  goals,
  debts,
  recurring,
  clearAllData,
  importData,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [lines, setLines] = useState([]);
  const [summary, setSummary] = useState(null);
  const [savingsLine, setSavingsLine] = useState(null);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [weeklyTotals, setWeeklyTotals] = useState([]);
  const [recipients, setRecipients] = useState('');
  const income = loadIncome(viewMonth);
  const [importResult, setImportResult] = useState(null);

  const isIncome = (id) => categories.items.find((c) => c.id === id)?.is_income ?? false;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (
        !wasmModule?.spend_by_category ||
        !wasmModule?.income_by_category ||
        !wasmModule?.daily_spend ||
        !wasmModule?.weekly_spend ||
        !wasmModule?.build_month
      )
        return;
      const monthTx = transactions.items.filter((tx) => tx.date?.startsWith(viewMonth));
      // Same split as BudgetTab: an income category's "actual" is what it
      // received, an expense category's is what it cost -- summing the
      // wrong side would report $0 for every income category, same as
      // the bug this fixed there.
      const [spendResult, incomeResult, dailyResult, weeklyResult] = await Promise.all([
        wasmModule.spend_by_category({ transactions: monthTx }),
        wasmModule.income_by_category({ transactions: monthTx }),
        wasmModule.daily_spend({ transactions: monthTx }),
        wasmModule.weekly_spend({ transactions: monthTx, month: viewMonth }),
      ]);
      if (!cancelled) {
        setDailyTotals(dailyResult?.totals ?? []);
        setWeeklyTotals(weeklyResult?.totals ?? []);
      }
      const spent = [
        ...(spendResult?.totals ?? []).filter((row) => !isIncome(row.category_id)),
        ...(incomeResult?.totals ?? []).filter((row) => isIncome(row.category_id)),
      ].map((r) => ({ category_id: r.category_id, amount: r.amount }));
      // Every known category, defaulting to 0 planned -- NOT budgetPlan.items
      // alone. `build_month` only returns lines for categories it is given a
      // planned entry for, so building this list from saved plan rows drops
      // every category that has spending but no typed budget. This is the
      // same trap CLAUDE.md documents for BudgetTab under "A new category
      // has no budget-plan entry until one is saved"; don't "simplify" this
      // back to budgetPlan.items alone.
      const planned = categories.items.map((c) => ({
        category_id: c.id,
        amount: budgetPlan.items.find((p) => p.category_id === c.id)?.planned ?? 0,
      }));
      const built = await wasmModule.build_month({ income, planned, previous_remaining: [], spent });
      if (!cancelled) {
        setLines(built?.lines ?? []);
        setSummary(built?.summary ?? null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, budgetPlan.items, categories.items, transactions.items, viewMonth, income]);

  // Same Savings computation as BudgetTab: income minus every real expense
  // category's actual this month. Kept out of `lines` (and so out of both
  // pie charts below) since Savings isn't a category money was spent from
  // or received into -- it's the residual of the two.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.build_savings_line || lines.length === 0) {
        if (!cancelled) setSavingsLine(null);
        return;
      }
      const planned = budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID)?.planned ?? 0;
      const expense = totalExpenseActual(lines, isIncome, () => false);
      const built = await wasmModule.build_savings_line({ planned, income, total_expense_actual: expense });
      if (!cancelled) setSavingsLine(built?.line ?? null);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, lines, budgetPlan.items, income]);

  const categoryName = (id) => categories.items.find((c) => c.id === id)?.name ?? id;

  // Two separate breakdowns, not one chart trying to show both
  // directions of money -- `l.spent` already holds whichever of
  // spend/income applies per category (see the fetch effect above), so
  // this just needs to route each category to the side it belongs on.
  const expenseSlices = lines
    .filter((l) => !isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({ id: l.category_id, label: categoryName(l.category_id), value: l.spent }));
  const incomeSlices = lines
    .filter((l) => isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({ id: l.category_id, label: categoryName(l.category_id), value: l.spent }));
  // The donut's own total, not `summary.total_spent` -- that figure sums
  // every line's `spent` regardless of income/expense, so it includes
  // income categories' received amounts too (see BudgetTab's identical
  // total). The expense wedges alone add up to less than that, and
  // labeling the ring's center with the bigger number would show a total
  // the ring itself doesn't visually account for.
  const expenseTotal = expenseSlices.reduce((sum, s) => sum + s.value, 0);
  const incomeTotal = incomeSlices.reduce((sum, s) => sum + s.value, 0);

  // The category table below groups the same way: every income line,
  // then every expense line, each block closed out with its own Total
  // row -- unlike expenseSlices/incomeSlices above, this isn't filtered
  // to l.spent > 0, since a category with nothing spent yet still belongs
  // in its group's total (at $0).
  const incomeLines = lines.filter((l) => isIncome(l.category_id));
  const expenseLines = lines.filter((l) => !isIncome(l.category_id));
  const sumLines = (rows) => ({
    planned: rows.reduce((sum, r) => sum + r.planned, 0),
    spent: rows.reduce((sum, r) => sum + r.spent, 0),
    remaining: rows.reduce((sum, r) => sum + r.remaining, 0),
  });
  const incomeTotals = sumLines(incomeLines);
  const expenseTotals = sumLines(expenseLines);

  // Same reframing every category row already uses -- an income row is
  // always good news regardless of remaining's sign, an expense row only
  // when it hasn't gone negative -- applied once more to the group's own
  // summed remaining.
  const categoryRow = (l) => {
    const isGoodNews = l.remaining >= 0 || isIncome(l.category_id);
    return (
      <tr key={l.category_id}>
        <td>{categoryName(l.category_id)}</td>
        <td className="num">{formatMoney(l.planned)}</td>
        <td className="num">{formatMoney(l.spent)}</td>
        <td className={`num ${isGoodNews ? 'positive' : 'negative'}`}>{formatMoney(l.remaining)}</td>
      </tr>
    );
  };

  const addresses = parseRecipients(recipients);
  const rejected = addresses.filter((a) => !looksLikeAddress(a));

  const bodyText = () => {
    const rows = lines
      .map((l) => `${categoryName(l.category_id)}: ${formatMoney(l.spent)} of ${formatMoney(l.planned)}`)
      .join('\n');
    const savingsRow = savingsLine
      ? `\n${t('budget.savings')}: ${formatMoney(savingsLine.spent)} of ${formatMoney(savingsLine.planned)}`
      : '';
    return `${t('dashboard.title')} — ${monthLabel(viewMonth, locale)}\n\n${rows}${savingsRow}\n\n${t('dashboard.generatedBy')}`;
  };

  const send = () => {
    if (addresses.length === 0 || rejected.length > 0) return;
    window.location.href = mailtoUrl({ recipients, subject: t('dashboard.mailSubject'), body: bodyText() });
  };

  // Everything the app holds, as one file the person keeps themselves --
  // the only way to move data between devices or make a backup, since
  // there is no server this app could hold a copy on.
  //
  // Always the app's real current month (`today`), not whatever month
  // Dashboard happens to be browsing -- budget-plan rows are fetched per
  // month, and this app has no "every month" listing to export.
  // `budgetPlan.items` tracks `viewMonth` now (App.jsx), so when someone
  // exports while browsing a different month, this fetches `today`'s plan
  // on demand instead of trusting `budgetPlan.items` -- the same one-off
  // `list_budget_plan` read this component used to do for an arbitrary
  // browsed month, just aimed at `today` instead.
  const exportData = async () => {
    const todaysPlan =
      viewMonth === today ? budgetPlan.items : ((await wasmModule?.list_budget_plan?.(today)) ?? []);
    const payload = {
      format: EXPORT_FORMAT,
      exported_at: new Date().toISOString(),
      categories: categories.items,
      transactions: transactions.items,
      rules: rules.items,
      goals: goals.items,
      debts: debts.items,
      recurring: recurring.items,
      budget_plan: { month: today, entries: todaysPlan },
      // Income lives in localStorage, not the store, so it has to be
      // named explicitly here. Leaving it out meant a restore came back
      // with every summary figure wrong until it was retyped.
      income: { month: today, amount: loadIncome(today) },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-planner-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let payload;
      try {
        payload = JSON.parse(String(reader.result ?? ''));
      } catch {
        setImportResult({ error: t('err.badImportFile') });
        return;
      }
      const outcome = await importData(payload);
      setImportResult(outcome);
    };
    reader.readAsText(file);
  };

  const hasIncome = income > 0;
  const isOverBudget = hasIncome && summary && summary.unspent < 0;

  return (
    <div className="panel report dashboard">
      <div className="dash-header">
        <h2>{t('dashboard.title')}</h2>
        <MonthYearPicker value={viewMonth} onChange={setViewMonth} todayMonth={today} locale={locale} />
      </div>

      {summary && hasIncome && (
        <div className={`dash-status${isOverBudget ? ' dash-status-over' : ' dash-status-good'}`}>
          <span className="dash-status-headline">
            {isOverBudget ? t('dashboard.overBudget') : t('dashboard.onTrack')}
          </span>
          <span className="dash-status-detail">
            {isOverBudget
              ? t('dashboard.overBudgetDetail', { amount: formatMoney(-summary.unspent) })
              : t('dashboard.onTrackDetail', { amount: formatMoney(summary.unspent) })}
          </span>
        </div>
      )}

      <div className="dash-summary-cards">
        <div className="dash-card dash-card-income">
          <span className="dash-card-label">{t('budget.income')}</span>
          <span className="dash-card-value">{formatMoney(summary?.income ?? 0)}</span>
        </div>
        <div className="dash-card dash-card-spent">
          <span className="dash-card-label">{t('budget.totalSpent')}</span>
          <span className="dash-card-value">{formatMoney(summary?.total_spent ?? 0)}</span>
        </div>
      </div>

      <div className="report-pies">
        <PieChart
          title={t('chart.expenseBreakdown')}
          items={expenseSlices}
          formatMoney={formatMoney}
          ariaLabel={t('chart.expenseBreakdownAria', { month: monthLabel(viewMonth, locale) })}
          hollow
          centerLabel={t('budget.spent')}
          centerValue={formatMoney(expenseTotal)}
          emptyHint={t('chart.noExpenseYet')}
        />
        <PieChart
          title={t('chart.incomeBreakdown')}
          items={incomeSlices}
          formatMoney={formatMoney}
          ariaLabel={t('chart.incomeBreakdownAria', { month: monthLabel(viewMonth, locale) })}
          hollow
          centerLabel={t('budget.received')}
          centerValue={formatMoney(incomeTotal)}
          emptyHint={t('chart.noIncomeYet')}
        />
      </div>

      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>{t('budget.categoryName')}</th>
              <th>{t('budget.planned')}</th>
              <th>{t('budget.actual')}</th>
              <th>{t('budget.remaining')}</th>
            </tr>
          </thead>
          <tbody>
            {incomeLines.map(categoryRow)}
            {incomeLines.length > 0 && (
              <>
                <tr className="dash-table-total">
                  <td>{t('dashboard.totalIncome')}</td>
                  <td className="num">{formatMoney(incomeTotals.planned)}</td>
                  <td className="num">{formatMoney(incomeTotals.spent)}</td>
                  <td className="num positive">{formatMoney(incomeTotals.remaining)}</td>
                </tr>
                <tr className="dash-table-divider" aria-hidden="true">
                  <td colSpan={4}>
                    <div className="dash-table-divider-line" />
                  </td>
                </tr>
              </>
            )}
            {expenseLines.map(categoryRow)}
            {expenseLines.length > 0 && (
              <>
                <tr className="dash-table-total">
                  <td>{t('dashboard.totalExpenses')}</td>
                  <td className="num">{formatMoney(expenseTotals.planned)}</td>
                  <td className="num">{formatMoney(expenseTotals.spent)}</td>
                  <td className={`num ${expenseTotals.remaining >= 0 ? 'positive' : 'negative'}`}>
                    {formatMoney(expenseTotals.remaining)}
                  </td>
                </tr>
                <tr className="dash-table-divider" aria-hidden="true">
                  <td colSpan={4}>
                    <div className="dash-table-divider-line" />
                  </td>
                </tr>
              </>
            )}
            {savingsLine && (
              <tr className="dash-table-total">
                <td>{t('budget.savings')}</td>
                <td className="num">{formatMoney(savingsLine.planned)}</td>
                <td className="num">{formatMoney(savingsLine.spent)}</td>
                <td className="num positive">{formatMoney(savingsLine.remaining)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <SpendOverTimeChart
        dailyTotals={dailyTotals}
        weeklyTotals={weeklyTotals}
        month={viewMonth}
        daysInMonth={daysInMonth(viewMonth)}
        formatMoney={formatMoney}
        locale={locale}
      />

      {goals.items.length > 0 && (
        <>
          <h2>{t('goals.title')}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>{t('goals.name')}</th><th>{t('goals.current')}</th><th>{t('goals.target')}</th></tr></thead>
              <tbody>
                {goals.items.map((g) => (
                  <tr key={g.id}><td>{g.name}</td><td className="num">{formatMoney(g.current_amount)}</td><td className="num">{formatMoney(g.target_amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {debts.items.length > 0 && (
        <>
          <h2>{t('debt.title')}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>{t('debt.name')}</th><th>{t('debt.balance')}</th><th>{t('debt.minPayment')}</th></tr></thead>
              <tbody>
                {debts.items.map((d) => (
                  <tr key={d.id}><td>{d.name}</td><td className="num">{formatMoney(d.balance)}</td><td className="num">{formatMoney(d.min_payment)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="report-actions no-print">
        <button className="btn" onClick={() => window.print()}>{t('dashboard.print')}</button>
      </div>

      <div className="form-grid no-print">
        <label className="field">
          <span className="field-label">{t('dashboard.recipients')}</span>
          <div className="field-input">
            <input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={t('dashboard.recipientsPlaceholder')} />
          </div>
        </label>
        <button className="btn secondary" onClick={send} disabled={addresses.length === 0 || rejected.length > 0}>
          {t('dashboard.send')}
        </button>
      </div>

      <div className="data-management no-print">
        <h2>{t('data.title')}</h2>
        <p className="panel-subtitle">{t('data.exportHint')}</p>
        <div className="data-management-actions">
          <button className="btn secondary" onClick={exportData}>{t('data.export')}</button>
          <label className="btn secondary import-button">
            {t('data.import')}
            <input type="file" accept="application/json,.json" onChange={onImportFile} />
          </label>
          <button className="btn danger" onClick={clearAllData}>{t('data.clearAll')}</button>
        </div>
        {importResult?.error && <p className="import-error" role="alert">{importResult.error}</p>}
        {importResult?.imported != null && (
          <p className="headline">{t('data.imported', { count: importResult.imported })}</p>
        )}
      </div>
    </div>
  );
}
