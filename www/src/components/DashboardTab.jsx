import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { daysInMonth, monthLabel } from '../month';
import CategoryBadge from './CategoryBadge';
import CategoryBreakdown from './CategoryBreakdown';
import DonutChart from './DonutChart';
import BlossomProgress, { BlossomWatermark } from './BlossomProgress';
import SpendOverTimeChart from './SpendOverTimeChart';
import MonthYearPicker from './MonthYearPicker';
import { SAVINGS_CATEGORY_ID, totalExpenseActual } from '../savings';
import { categoryDisplayName } from '../presetCategories';
import { categoryColor } from '../categoryVisuals';

/**
 * The setup ladder's three steps, each naming its own i18n keys and which
 * tab (or the Add sheet) its call to action opens -- a lookup table
 * rather than building keys with a template literal, so every key `t()`
 * is ever called with stays a plain string literal
 * (`untranslated-strings.test.js` reads this file's source text and can't
 * resolve a template literal's dynamic half). Keyed by the exact state
 * string `budget_calc::month_setup_state` returns, so there is no second
 * "which step is next" decision here -- Rust already made it.
 */
const SETUP_STEPS = {
  setup_plan_income: {
    titleKey: 'dashboard.setup.planIncomeTitle',
    detailKey: 'dashboard.setup.planIncomeDetail',
    ctaKey: 'dashboard.setup.planIncomeCta',
    tab: 'budget',
  },
  setup_assign_remaining: {
    titleKey: 'dashboard.setup.assignRemainingTitle',
    detailKey: 'dashboard.setup.assignRemainingDetail',
    ctaKey: 'dashboard.setup.assignRemainingCta',
    tab: 'budget',
  },
  // The only step whose CTA opens the Add sheet rather than changing
  // tab: "Log a transaction" that dropped someone on the Transactions
  // tab left them looking at an empty list, one tap short of the thing
  // the button had just offered to do.
  setup_log_transaction: {
    titleKey: 'dashboard.setup.logTransactionTitle',
    detailKey: 'dashboard.setup.logTransactionDetail',
    ctaKey: 'dashboard.setup.logTransactionCta',
    add: 'manual',
  },
};

/** A `YYYY-MM-DD` as a short local date, e.g. "Sep 12" -- same
 *  hand-joined `toLocaleDateString` approach `month.js`'s `weekLabel`
 *  uses, for the same reason: `Intl.DateTimeFormat.prototype.formatRange`
 *  isn't as uniformly supported. */
function shortDate(iso, locale) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * The landing tab: one hero figure for whichever of Overview's seven
 * states the viewed month is actually in (see
 * `budget_calc::month_setup_state`), a donut and three-up stat strip
 * beneath it once there's something to show, and the category rows below
 * that. `viewMonth` is shared app-wide (App.jsx) -- paging Dashboard back
 * to a prior month is the same month Budget/Transactions land on too.
 * `budgetPlan.items` already tracks `viewMonth` (App.jsx fetches it keyed
 * by `viewMonth`), so this tab reads it directly rather than keeping its
 * own copy.
 */
export default function DashboardTab({
  wasmModule,
  currencySymbol,
  today,
  viewMonth,
  setViewMonth,
  categories,
  transactions,
  budgetPlan,
  goals,
  debts,
  onNavigateTab,
  onOpenAdd,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [lines, setLines] = useState([]);
  const [summary, setSummary] = useState(null);
  const [savingsLine, setSavingsLine] = useState(null);
  const [savingsPetals, setSavingsPetals] = useState(0);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [weeklyTotals, setWeeklyTotals] = useState([]);
  const [shares, setShares] = useState([]);
  const [heroState, setHeroState] = useState(null);
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
      const builtLines = built?.lines ?? [];
      const builtSummary = built?.summary ?? null;
      if (!cancelled) {
        setLines(builtLines);
        setSummary(builtSummary);
      }

      // Which of Overview's seven states this month is in -- see
      // `budget_calc::month_setup_state`'s own doc comment for the full
      // rule. Computed in the same effect pass as `lines`/`summary`
      // (rather than a separate effect keyed off them) so the hero and
      // the figures it's built from always land in the same render.
      const stateResult = wasmModule.month_setup_state
        ? await wasmModule.month_setup_state({
            is_current_month: viewMonth === today,
            has_transactions: monthTx.length > 0,
            income: builtSummary?.income ?? 0,
            unassigned: builtSummary?.unassigned ?? 0,
          })
        : null;
      if (!cancelled) setHeroState(stateResult?.state ?? null);

      // Each expense category's share of this month's spending, for the
      // donut's wedges and the ranked rows' percent labels -- see
      // `budget_calc::category_shares`'s own doc comment for why this
      // division moved out of a frontend `.map()`.
      const expenseEntries = builtLines
        .filter((l) => !isIncome(l.category_id) && l.spent > 0)
        .map((l) => ({ category_id: l.category_id, amount: l.spent }));
      const sharesResult = wasmModule.category_shares
        ? await wasmModule.category_shares({ entries: expenseEntries })
        : null;
      if (!cancelled) setShares(sharesResult?.shares ?? []);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, budgetPlan.items, categories.items, transactions.items, viewMonth, today]);

  // Same Savings computation as BudgetTab: income minus every real expense
  // category's actual this month. Kept out of `lines` (and so out of the
  // donut/rows below) since Savings isn't a category money was spent from
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

  // How many of the blossom's five petals Savings has earned -- the same
  // `goal_progress` call a goal's own preview card makes, just against
  // the month's planned savings instead of a goal's target. Replaces a
  // real, shipped bug: the blossom used to fill from
  // `savingsLine.spent >= 0 ? 5 : 0`, so a Savings of exactly $0.00 drew
  // all five petals celebrating nothing.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.goal_progress || !savingsLine) {
        if (!cancelled) setSavingsPetals(0);
        return;
      }
      const planned =
        budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID)?.planned ?? 0;
      const result = await wasmModule.goal_progress({
        current_amount: savingsLine.spent,
        target_amount: planned,
      });
      if (!cancelled) setSavingsPetals(result?.petals_filled ?? 0);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, savingsLine, budgetPlan.items]);

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
  const categoryName = (id) => {
    const c = categoryFor(id);
    return c ? categoryDisplayName(c, t) : id;
  };

  // The ranked rows below the donut -- expense categories only now
  // (income is a plain stat in the strip, not a second breakdown; see
  // CategoryBreakdown's own note on why a single tab skips its switcher).
  const expenseSlices = lines
    .filter((l) => !isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({
      id: l.category_id,
      label: categoryName(l.category_id),
      value: l.spent,
      category: categoryFor(l.category_id),
    }));

  const expenseTotals = {
    spent: lines.filter((l) => !isIncome(l.category_id)).reduce((sum, l) => sum + l.spent, 0),
  };

  // The donut's wedges: Rust already decided each category's share
  // (`category_shares`), so this only attaches the display color that
  // decision has no business knowing about.
  const wedges = shares.map((s) => ({
    id: s.category_id,
    share: s.share,
    color: categoryColor(categoryFor(s.category_id)),
  }));

  const monthTx = transactions.items
    .filter((tx) => tx.date?.startsWith(viewMonth))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const busiestDay =
    dailyTotals.length > 0
      ? dailyTotals.reduce((max, d) => (d.amount > max.amount ? d : max))
      : null;

  /**
   * The row tapped open below the ranked rows -- shows the same
   * planned/actual/remaining split as before, followed by up to 5 of this
   * category's transactions for the viewed month, most recent first.
   */
  const drilldown = (ids) => {
    if (!selectedCategoryId || !ids.includes(selectedCategoryId)) return null;
    const line = lines.find((l) => l.category_id === selectedCategoryId);
    if (!line) return null;
    const isGoodNews = line.remaining >= 0;
    const catTx = monthTx
      .filter((tx) => tx.category_id === selectedCategoryId)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const shown = catTx.slice(0, 5);
    const moreCount = catTx.length - shown.length;
    return (
      <div className="bubble-detail money-card" ref={detailRef}>
        <div className="category-name">
          <CategoryBadge category={categoryFor(selectedCategoryId)} />
          {categoryName(selectedCategoryId)}
        </div>
        <div className="dash-card-stats">
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

  const donutAndRows = (
    <>
      <DonutChart
        wedges={wedges}
        centerValue={formatMoney(expenseTotals.spent)}
        centerLabel={t('chart.expenseBreakdown')}
        ariaLabel={t('chart.expenseBreakdownAria', { month: monthLabel(viewMonth, locale) })}
      />
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
        ]}
        formatMoney={formatMoney}
        selectedId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
        detail={drilldown(expenseSlices.map((s) => s.id))}
      />
      <SpendOverTimeChart
        dailyTotals={dailyTotals}
        weeklyTotals={weeklyTotals}
        month={viewMonth}
        daysInMonth={daysInMonth(viewMonth)}
        formatMoney={formatMoney}
        locale={locale}
      />
    </>
  );

  const statStrip = (
    <div className="dash-stat-strip">
      <div className="dash-stat-tile">
        <span className="dash-stat-tile-label">{t('dashboard.stat.leftToSpend')}</span>
        <span
          className={`dash-stat-tile-value ${(summary?.unspent ?? 0) >= 0 ? 'positive' : 'negative'}`}
        >
          {formatMoney(summary?.unspent ?? 0)}
        </span>
      </div>
      <div className="dash-stat-tile">
        <span className="dash-stat-tile-label">{t('dashboard.income')}</span>
        <span className="dash-stat-tile-value">{formatMoney(summary?.income ?? 0)}</span>
      </div>
      <div className="dash-stat-tile">
        <span className="dash-stat-tile-label">{t('dashboard.stat.busiestDay')}</span>
        <span className="dash-stat-tile-value">
          {busiestDay ? formatMoney(busiestDay.amount) : '—'}
        </span>
      </div>
    </div>
  );

  const hero = () => {
    if (!heroState) return null;

    if (heroState === 'other_month_empty') {
      return (
        <div className="dash-hero dash-hero-empty money-card">
          <span className="dash-hero-label">
            {t('dashboard.hero.otherMonthTitle', { month: monthLabel(viewMonth, locale) })}
          </span>
          <button type="button" className="btn ghost" onClick={() => setViewMonth(today)}>
            {t('dashboard.hero.otherMonthCta', { month: monthLabel(today, locale) })}
          </button>
        </div>
      );
    }

    const setupStep = SETUP_STEPS[heroState];
    if (setupStep) {
      // Replaces the donut/rows/stat strip entirely, not just adds a
      // banner above them -- a wall of $0.00 and an empty chart said
      // nothing a first-time visitor needed, and competed with the one
      // thing that did. `budget`/`transactions` both stay reachable
      // through the primary tab bar regardless of this card's own CTA.
      return (
        <div className="dash-setup-card money-card">
          <span className="dash-setup-badge" aria-hidden="true">
            →
          </span>
          <div className="dash-setup-body">
            <span className="dash-setup-title">{t(setupStep.titleKey)}</span>
            <p className="dash-setup-detail">{t(setupStep.detailKey)}</p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setupStep.add ? onOpenAdd?.(setupStep.add) : onNavigateTab?.(setupStep.tab)
            }
          >
            {t(setupStep.ctaKey)}
          </button>
        </div>
      );
    }

    if (heroState === 'spent_so_far') {
      return (
        <>
          <div className="dash-hero money-card">
            <span className="dash-hero-label">{t('dashboard.hero.spentSoFar')}</span>
            <span className="dash-hero-value negative">{formatMoney(expenseTotals.spent)}</span>
            {monthTx.length > 0 && (
              <span className="dash-hero-note">
                {t('dashboard.hero.spentSoFarNote', {
                  count: monthTx.length,
                  date: shortDate(monthTx[0].date, locale),
                })}
              </span>
            )}
          </div>
          <button type="button" className="dash-nudge" onClick={() => onNavigateTab?.('budget')}>
            <span>{t('dashboard.hero.addIncomeNudge')}</span>
            <span className="dash-nudge-go" aria-hidden="true">
              &rsaquo;
            </span>
          </button>
          {donutAndRows}
        </>
      );
    }

    // savings_unassigned / savings_complete: Savings is the hero either
    // way (see the design spec's "Savings is the hero" section) -- the
    // blossom itself only appears once income is fully assigned, since a
    // partial blossom next to an "unassigned" nudge would read as a
    // half-finished result rather than an in-progress one.
    const positive = (savingsLine?.spent ?? 0) >= 0;
    return (
      <>
        <div className="dash-hero dash-hero-savings money-card">
          <BlossomWatermark className="dash-blossom-watermark" />
          <div className="dash-hero-top">
            <span className="dash-hero-label">{t('budget.savings')}</span>
            {heroState === 'savings_complete' && (
              <div className={`dash-hero-blossom ${positive ? 'positive' : 'negative'}`}>
                <BlossomProgress filled={savingsPetals} size={26} />
              </div>
            )}
          </div>
          <span className={`dash-hero-value ${positive ? 'positive' : 'negative'}`}>
            {formatMoney(savingsLine?.spent ?? 0)}
          </span>
        </div>
        {heroState === 'savings_unassigned' && (
          <button type="button" className="dash-nudge" onClick={() => onNavigateTab?.('budget')}>
            <span>
              {t('dashboard.hero.unassignedNudge', {
                amount: formatMoney(summary?.unassigned ?? 0),
              })}
            </span>
            <span className="dash-nudge-go" aria-hidden="true">
              &rsaquo;
            </span>
          </button>
        )}
        {statStrip}
        {donutAndRows}
      </>
    );
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

      {hero()}

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
    </div>
  );
}
