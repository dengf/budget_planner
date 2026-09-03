import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { daysInMonth, monthLabel } from '../month';
import { looksLikeAddress, mailtoUrl, parseRecipients } from '../mailto';
import CategoryBadge from './CategoryBadge';
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
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [lines, setLines] = useState([]);
  const [summary, setSummary] = useState(null);
  const [savingsLine, setSavingsLine] = useState(null);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [weeklyTotals, setWeeklyTotals] = useState([]);
  const [recipients, setRecipients] = useState('');
  const isCurrentMonth = viewMonth === today;

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
      // Income isn't stored separately any more -- `build_month` derives
      // it in Rust from whichever of these `planned` entries belong to an
      // income category (see BudgetTab's identical comment).
      const incomeCategoryIds = categories.items.filter((c) => c.is_income).map((c) => c.id);
      const built = await wasmModule.build_month({
        planned,
        previous_remaining: [],
        spent,
        income_category_ids: incomeCategoryIds,
      });
      if (!cancelled) {
        setLines(built?.lines ?? []);
        setSummary(built?.summary ?? null);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, budgetPlan.items, categories.items, transactions.items, viewMonth]);

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
      const planned =
        budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID)?.planned ?? 0;
      const expense = totalExpenseActual(lines, isIncome, () => false);
      const built = await wasmModule.build_savings_line({
        planned,
        income: summary?.income ?? 0,
        total_expense_actual: expense,
      });
      if (!cancelled) setSavingsLine(built?.line ?? null);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, lines, budgetPlan.items, summary]);

  const categoryFor = (id) => categories.items.find((c) => c.id === id);
  const categoryName = (id) => categories.items.find((c) => c.id === id)?.name ?? id;

  // Two separate breakdowns, not one chart trying to show both
  // directions of money -- `l.spent` already holds whichever of
  // spend/income applies per category (see the fetch effect above), so
  // this just needs to route each category to the side it belongs on.
  // `preset_key` rides along so PieChart can color each wedge the same
  // way CategoryBadge colors that category everywhere else (see
  // categoryVisuals.js's categoryColor) -- chart and lists agreeing on
  // color is the whole point of this pass.
  const expenseSlices = lines
    .filter((l) => !isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({
      id: l.category_id,
      label: categoryName(l.category_id),
      value: l.spent,
      preset_key: categoryFor(l.category_id)?.preset_key,
    }));
  const incomeSlices = lines
    .filter((l) => isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({
      id: l.category_id,
      label: categoryName(l.category_id),
      value: l.spent,
      preset_key: categoryFor(l.category_id)?.preset_key,
    }));
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

  // This card is the plain-numbers summary (BudgetTab is where planned
  // income and its "received more than planned"/"unplanned income"
  // framing actually get edited and explained). Here, an income card's
  // Planned and Remaining would just be a $0.00 and a green negative
  // number with no explanation of why negative is good -- confusing
  // rather than informative, so income cards show Actual only.
  const categoryCard = (l) => {
    const income = isIncome(l.category_id);
    const isGoodNews = l.remaining >= 0;
    return (
      <div className="dash-category-card money-card" key={l.category_id}>
        <div className="category-name">
          <CategoryBadge category={categoryFor(l.category_id)} />
          {categoryName(l.category_id)}
        </div>
        <div className="dash-card-stats">
          {income ? (
            <span className="dash-stat">
              <span className="cell-label">{t('budget.actual')}</span>
              <span className="num">{formatMoney(l.spent)}</span>
            </span>
          ) : (
            <>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.planned')}</span>
                <span className="num">{formatMoney(l.planned)}</span>
              </span>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.actual')}</span>
                <span className="num">{formatMoney(l.spent)}</span>
              </span>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.remaining')}</span>
                <span className={`num ${isGoodNews ? 'positive' : 'negative'}`}>
                  {formatMoney(l.remaining)}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
    );
  };

  const addresses = parseRecipients(recipients);
  const rejected = addresses.filter((a) => !looksLikeAddress(a));

  const bodyText = () => {
    const rows = lines
      .map(
        (l) =>
          `${categoryName(l.category_id)}: ${formatMoney(l.spent)} of ${formatMoney(l.planned)}`,
      )
      .join('\n');
    const savingsRow = savingsLine
      ? `\n${t('budget.savings')}: ${formatMoney(savingsLine.spent)} of ${formatMoney(savingsLine.planned)}`
      : '';
    return `${t('dashboard.title')} — ${monthLabel(viewMonth, locale)}\n\n${rows}${savingsRow}\n\n${t('dashboard.generatedBy')}`;
  };

  const send = () => {
    if (addresses.length === 0 || rejected.length > 0) return;
    window.location.href = mailtoUrl({
      recipients,
      subject: t('dashboard.mailSubject'),
      body: bodyText(),
    });
  };

  const hasIncome = (summary?.income ?? 0) > 0;
  const isOverBudget = hasIncome && summary && summary.unspent < 0;

  return (
    <div className="panel report dashboard">
      <div className="dash-header">
        <h2>{t('dashboard.title')}</h2>
        <MonthYearPicker
          value={viewMonth}
          onChange={setViewMonth}
          todayMonth={today}
          locale={locale}
        />
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
          <span className="dash-card-label">
            {isCurrentMonth
              ? t('budget.income')
              : t('budget.incomeFor', { month: monthLabel(viewMonth, locale) })}
          </span>
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

      <div className="dash-category-list">
        {incomeLines.map(categoryCard)}
        {incomeLines.length > 0 && (
          <>
            <div className="dash-total-card">
              <span className="dash-total-name">{t('dashboard.totalIncome')}</span>
              <div className="dash-card-stats">
                <span className="dash-stat">
                  <span className="cell-label">{t('budget.actual')}</span>
                  <span className="num">{formatMoney(incomeTotals.spent)}</span>
                </span>
              </div>
            </div>
            <div className="dash-table-divider-line" aria-hidden="true" />
          </>
        )}
        {expenseLines.map(categoryCard)}
        {expenseLines.length > 0 && (
          <>
            <div className="dash-total-card">
              <span className="dash-total-name">{t('dashboard.totalExpenses')}</span>
              <div className="dash-card-stats">
                <span className="dash-stat">
                  <span className="cell-label">{t('budget.planned')}</span>
                  <span className="num">{formatMoney(expenseTotals.planned)}</span>
                </span>
                <span className="dash-stat">
                  <span className="cell-label">{t('budget.actual')}</span>
                  <span className="num">{formatMoney(expenseTotals.spent)}</span>
                </span>
                <span className="dash-stat">
                  <span className="cell-label">{t('budget.remaining')}</span>
                  <span className={`num ${expenseTotals.remaining >= 0 ? 'positive' : 'negative'}`}>
                    {formatMoney(expenseTotals.remaining)}
                  </span>
                </span>
              </div>
            </div>
            <div className="dash-table-divider-line" aria-hidden="true" />
          </>
        )}
        {savingsLine && (
          <div className="dash-total-card">
            <span className="dash-total-name">{t('budget.savings')}</span>
            <div className="dash-card-stats">
              <span className="dash-stat">
                <span className="cell-label">{t('budget.planned')}</span>
                <span className="num">{formatMoney(savingsLine.planned)}</span>
              </span>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.actual')}</span>
                <span className="num">{formatMoney(savingsLine.spent)}</span>
              </span>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.remaining')}</span>
                <span
                  className={`num ${savingsLine.spent - savingsLine.planned >= 0 ? 'positive' : 'negative'}`}
                >
                  {formatMoney(savingsLine.spent - savingsLine.planned)}
                </span>
              </span>
            </div>
          </div>
        )}
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
              <thead>
                <tr>
                  <th>{t('goals.name')}</th>
                  <th>{t('goals.current')}</th>
                  <th>{t('goals.target')}</th>
                </tr>
              </thead>
              <tbody>
                {goals.items.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td className="num">{formatMoney(g.current_amount)}</td>
                    <td className="num">{formatMoney(g.target_amount)}</td>
                  </tr>
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
              <thead>
                <tr>
                  <th>{t('debt.name')}</th>
                  <th>{t('debt.balance')}</th>
                  <th>{t('debt.minPayment')}</th>
                </tr>
              </thead>
              <tbody>
                {debts.items.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td className="num">{formatMoney(d.balance)}</td>
                    <td className="num">{formatMoney(d.min_payment)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="report-actions no-print">
        <button className="btn" onClick={() => window.print()}>
          {t('dashboard.print')}
        </button>
      </div>

      <div className="form-grid no-print">
        <label className="field">
          <span className="field-label">{t('dashboard.recipients')}</span>
          <div className="field-input">
            <input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={t('dashboard.recipientsPlaceholder')}
            />
          </div>
        </label>
        <button
          className="btn secondary"
          onClick={send}
          disabled={addresses.length === 0 || rejected.length > 0}
        >
          {t('dashboard.send')}
        </button>
      </div>
    </div>
  );
}
