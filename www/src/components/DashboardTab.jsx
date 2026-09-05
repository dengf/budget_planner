import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { daysInMonth, monthLabel } from '../month';
import { looksLikeAddress, mailtoUrl, parseRecipients } from '../mailto';
import CategoryBadge from './CategoryBadge';
import CategoryBreakdown from './CategoryBreakdown';
import BlossomProgress, { BlossomWatermark } from './BlossomProgress';
import SpendOverTimeChart from './SpendOverTimeChart';
import MonthYearPicker from './MonthYearPicker';
import { SAVINGS_CATEGORY_ID, totalExpenseActual } from '../savings';

/**
 * Lets a long money string wrap at a digit-group boundary instead of
 * wherever the browser's own line-breaking happens to land -- needed
 * because `.dash-card-value`'s `overflow-wrap: anywhere` (main.css) has
 * no comma to prefer over any other character otherwise. Only the
 * summary row's 3-across mobile layout is narrow enough for this to ever
 * matter; a 6-figure "$43,000.00" already fits that row on one line, but
 * a 7-figure income/expense figure shouldn't wrap mid-digit-group into
 * something like "$1,234,5" / "67.00".
 */
function breakableMoney(str) {
  const parts = str.split(',');
  return parts.flatMap((part, i) => (i === 0 ? [part] : [',', <wbr key={i} />, part]));
}

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
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [goalProgress, setGoalProgress] = useState({});
  const detailRef = useRef(null);

  const isIncome = (id) => categories.items.find((c) => c.id === id)?.is_income ?? false;

  // The tapped row's detail card renders as the next row in the list
  // (see `drilldown` below), which can sit several rows below the one
  // actually tapped -- easy to miss without scrolling. Bringing it into
  // view on tap, rather than making the user go find it, is the fix;
  // `smooth` degrades to an instant jump under prefers-reduced-motion,
  // matching this app's convention elsewhere.
  useEffect(() => {
    if (!selectedCategoryId || !detailRef.current) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    detailRef.current.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [selectedCategoryId]);

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

  // Petal count for each goal's preview card below -- the same
  // `goal_progress` call GoalsTab makes per goal, just batched here since
  // this tab shows every goal at once rather than one at a time. Kept in
  // Rust (petals_filled's fifths division) rather than deriving it here
  // from current_amount/target_amount, same reasoning as everywhere else
  // in this app that a ratio-to-bucket rule belongs in budget-calc.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.goal_progress || goals.items.length === 0) {
        if (!cancelled) setGoalProgress({});
        return;
      }
      const entries = await Promise.all(
        goals.items.map(async (g) => {
          const p = await wasmModule.goal_progress({
            current_amount: g.current_amount,
            target_amount: g.target_amount,
          });
          return [g.id, p?.petals_filled ?? 0];
        }),
      );
      if (!cancelled) setGoalProgress(Object.fromEntries(entries));
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, goals.items]);

  const categoryFor = (id) => categories.items.find((c) => c.id === id);
  const categoryName = (id) => categories.items.find((c) => c.id === id)?.name ?? id;

  // Two separate breakdowns, not one chart trying to show both
  // directions of money -- `l.spent` already holds whichever of
  // spend/income applies per category (see the fetch effect above), so
  // this just needs to route each category to the side it belongs on.
  // The real `category` record rides along (not just its preset_key) so
  // BubbleChart can hand it straight to CategoryBadge's own
  // `categoryColor`/`categoryIconId` -- chart and badges agreeing on
  // color/icon is the whole point of this pass.
  const expenseSlices = lines
    .filter((l) => !isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({
      id: l.category_id,
      label: categoryName(l.category_id),
      value: l.spent,
      category: categoryFor(l.category_id),
    }));
  const incomeSlices = lines
    .filter((l) => isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({
      id: l.category_id,
      label: categoryName(l.category_id),
      value: l.spent,
      category: categoryFor(l.category_id),
    }));

  // Whole-month totals for the summary cards. Not `summary.total_spent`
  // for the expense figure -- that sums every line's `spent` regardless
  // of income/expense, so it includes income categories' received
  // amounts too (same figure BudgetTab avoids for its own total for the
  // same reason). `expenseTotals.spent` is the pure expense-only sum.
  const incomeLines = lines.filter((l) => isIncome(l.category_id));
  const expenseLines = lines.filter((l) => !isIncome(l.category_id));
  const sumLines = (rows) => ({
    planned: rows.reduce((sum, r) => sum + r.planned, 0),
    spent: rows.reduce((sum, r) => sum + r.spent, 0),
    remaining: rows.reduce((sum, r) => sum + r.remaining, 0),
  });
  const expenseTotals = sumLines(expenseLines);
  // Actual received, same basis as `incomeSlices` -- not `summary.income`
  // (that's the planned/budgeted figure the top-of-page Income card shows,
  // a deliberately different metric). The breakdown card's total sits
  // directly above its own row list, so it has to reconcile with what
  // those rows actually sum to, same as the expense tab's total already
  // does with `expenseTotals.spent`.
  const incomeTotals = sumLines(incomeLines);

  /**
   * The row tapped open below one of the two charts -- income and expense
   * rows share one `selectedCategoryId` (tapping a row in either chart
   * closes whichever was open, including one in the other chart), and
   * each chart only renders the panel if the selected id is one of its
   * own. Shows the same planned/actual/remaining split
   * `categoryCard` used to (income categories show Actual only -- see
   * that removed function's original comment: a $0.00 Planned and a
   * green "negative" Remaining on an income row explained nothing),
   * followed by up to 5 of this category's transactions for the viewed
   * month, most recent first.
   */
  const drilldown = (ids) => {
    if (!selectedCategoryId || !ids.includes(selectedCategoryId)) return null;
    const line = lines.find((l) => l.category_id === selectedCategoryId);
    if (!line) return null;
    const income = isIncome(selectedCategoryId);
    const isGoodNews = line.remaining >= 0;
    const monthTx = transactions.items
      .filter((tx) => tx.category_id === selectedCategoryId && tx.date?.startsWith(viewMonth))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const shown = monthTx.slice(0, 5);
    const moreCount = monthTx.length - shown.length;
    return (
      <div className="bubble-detail money-card" ref={detailRef}>
        <div className="category-name">
          <CategoryBadge category={categoryFor(selectedCategoryId)} />
          {categoryName(selectedCategoryId)}
        </div>
        <div className="dash-card-stats">
          {income ? (
            <span className="dash-stat">
              <span className="cell-label">{t('budget.actual')}</span>
              <span className="num">{formatMoney(line.spent)}</span>
            </span>
          ) : (
            <>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.planned')}</span>
                <span className="num">{formatMoney(line.planned)}</span>
              </span>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.actual')}</span>
                <span className="num">{formatMoney(line.spent)}</span>
              </span>
              <span className="dash-stat">
                <span className="cell-label">{t('budget.remaining')}</span>
                <span className={`num ${isGoodNews ? 'positive' : 'negative'}`}>
                  {formatMoney(line.remaining)}
                </span>
              </span>
            </>
          )}
        </div>
        {shown.length > 0 && (
          <ul className="bubble-detail-tx-list">
            {shown.map((tx) => (
              <li key={tx.id} className="bubble-detail-tx-row">
                <span className="bubble-detail-tx-date">{tx.date}</span>
                <span className="bubble-detail-tx-desc">{tx.description}</span>
                <span className="num">{formatMoney(tx.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        {moreCount > 0 && (
          <p className="chart-note">{t('dashboard.moreTransactions', { count: moreCount })}</p>
        )}
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

      <div className="dash-summary-cards">
        {savingsLine && (
          <div className="dash-card dash-card-hero dash-card-savings">
            <BlossomWatermark className="dash-blossom-watermark" />
            <div className="dash-card-hero-top">
              <span className="dash-card-label">{t('budget.savings')}</span>
              <div
                className={`dash-card-blossom ${savingsLine.spent >= 0 ? 'positive' : 'negative'}`}
              >
                <BlossomProgress filled={savingsLine.spent >= 0 ? 5 : 0} size={26} />
              </div>
            </div>
            <span className={`dash-card-value ${savingsLine.spent >= 0 ? 'positive' : 'negative'}`}>
              {breakableMoney(formatMoney(savingsLine.spent))}
            </span>
          </div>
        )}
        <div className="dash-summary-secondary">
          <div className="dash-card">
            <span className="dash-card-label">{t('dashboard.income')}</span>
            <span className="dash-card-value positive">
              {breakableMoney(formatMoney(summary?.income ?? 0))}
            </span>
          </div>
          <div className="dash-card">
            <span className="dash-card-label">{t('dashboard.totalExpenses')}</span>
            <span className="dash-card-value negative">
              {breakableMoney(formatMoney(expenseTotals.spent))}
            </span>
          </div>
        </div>
      </div>

      <CategoryBreakdown
        tabs={[
          {
            key: 'expense',
            label: t('chart.expenseBreakdown'),
            items: expenseSlices,
            ariaLabel: t('chart.expenseBreakdownAria', { month: monthLabel(viewMonth, locale) }),
            hint: t('dashboard.bubbleHint'),
            totalLabel: formatMoney(expenseTotals.spent),
            emptyHint: t('chart.noExpenseYet'),
          },
          {
            key: 'income',
            label: t('chart.incomeBreakdown'),
            items: incomeSlices,
            ariaLabel: t('chart.incomeBreakdownAria', { month: monthLabel(viewMonth, locale) }),
            totalLabel: formatMoney(incomeTotals.spent),
            emptyHint: t('chart.noIncomeYet'),
          },
        ]}
        formatMoney={formatMoney}
        selectedId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
        detail={
          drilldown(expenseSlices.map((s) => s.id)) ?? drilldown(incomeSlices.map((s) => s.id))
        }
      />

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
          <div className="dash-preview-row">
            {goals.items.map((g) => (
              <div className="dash-preview-card money-card" key={g.id}>
                <BlossomProgress filled={goalProgress[g.id] ?? 0} size={36} />
                <div className="dash-preview-card-info">
                  <span className="dash-preview-card-name">{g.name}</span>
                  <span className="dash-preview-card-detail">
                    {formatMoney(g.current_amount)} / {formatMoney(g.target_amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {debts.items.length > 0 && (
        <>
          <h2>{t('debt.title')}</h2>
          <div className="dash-preview-row">
            {debts.items.map((d) => (
              <div className="dash-preview-card money-card" key={d.id}>
                <div className="dash-preview-card-info">
                  <span className="dash-preview-card-name">{d.name}</span>
                  <span className="dash-preview-card-detail">
                    {t('debt.balance')}: {formatMoney(d.balance)} · {t('debt.minPayment')}:{' '}
                    {formatMoney(d.min_payment)}
                  </span>
                </div>
              </div>
            ))}
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
