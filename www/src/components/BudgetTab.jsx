import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { daysLeftInMonth, monthLabel, todayIso } from '../month';
import CalcError from './CalcError';
import CategoryBadge from './CategoryBadge';
import SpendChart from './SpendChart';
import MonthYearPicker from './MonthYearPicker';
import {
  DEBT_PREFIX,
  GOAL_PREFIX,
  isCommitmentId,
  loadIncludeCommitments,
  saveIncludeCommitments,
} from '../commitments';
import { monthsBetween } from '../month';
import { SAVINGS_CATEGORY_ID, totalExpenseActual } from '../savings';

/**
 * `previous_remaining` (rollover) is passed as `[]` -- every month is
 * planned independently for now. `budget-calc::build_month` already
 * accepts a prior month's remaining balances; wiring the frontend to
 * carry them forward month-over-month is real, sizeable state (finding
 * and summing the actual previous month) left for a follow-up round
 * rather than this one.
 */
export default function BudgetTab({
  wasmModule,
  currencySymbol,
  today,
  viewMonth,
  setViewMonth,
  categories,
  removeCategory,
  addCommonCategories,
  transactions,
  budgetPlan,
  goals,
  debts,
  recurring,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [result, setResult] = useState(null);
  const [newCategory, setNewCategory] = useState({ name: '', group: '', isIncome: false });
  const [plannedDraft, setPlannedDraft] = useState({});
  // Which category's "log spending" row is open, and what's typed in it.
  const [spendFor, setSpendFor] = useState(null);
  const [spendDraft, setSpendDraft] = useState({ amount: '', description: '' });
  const [includeCommitments, setIncludeCommitments] = useState(() => loadIncludeCommitments());
  const [upcoming, setUpcoming] = useState(null);
  const [savingsResult, setSavingsResult] = useState(null);

  const monthTransactions = useMemo(
    () => transactions.items.filter((tx) => tx.date?.startsWith(viewMonth)),
    [transactions.items, viewMonth],
  );

  const isCurrentMonth = viewMonth === today;
  const isPastMonth = viewMonth < today;

  const isIncome = (id) => categories.items.find((c) => c.id === id)?.is_income ?? false;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (
        !wasmModule?.spend_by_category ||
        !wasmModule?.income_by_category ||
        !wasmModule?.build_month
      )
        return;
      // Two separate totals, one per side of the ledger -- an income
      // category's "actual" is what it received (the positive side of its
      // transactions), an expense category's is what it cost (the negative
      // side). Each result set is filtered to the categories that actually
      // belong on that side before merging, so a stray transaction
      // categorized against the wrong kind of category can't leak its
      // total into a line it doesn't belong on.
      const [spendResult, incomeResult] = await Promise.all([
        wasmModule.spend_by_category({ transactions: monthTransactions }),
        wasmModule.income_by_category({ transactions: monthTransactions }),
      ]);
      const spent = [
        ...(spendResult?.totals ?? []).filter((row) => !isIncome(row.category_id)),
        ...(incomeResult?.totals ?? []).filter((row) => isIncome(row.category_id)),
      ].map((t) => ({ category_id: t.category_id, amount: t.amount }));
      // Every known category gets a planned line, defaulting to 0 -- not
      // only the ones with a saved plan entry. Otherwise a category
      // freshly added this session has nothing to type an amount into: it
      // exists, but build_month never hears about it until something else
      // creates a plan row for it first.
      const planned = categories.items.map((c) => ({
        category_id: c.id,
        amount: budgetPlan.items.find((p) => p.category_id === c.id)?.planned ?? 0,
      }));
      // Income isn't typed in separately any more -- `build_month`
      // derives it in Rust from whichever of these `planned` entries
      // belong to an income category, so the only thing this side needs
      // to hand over is which ids those are.
      const incomeCategoryIds = categories.items.filter((c) => c.is_income).map((c) => c.id);

      // Goals and debts, when the toggle is on, join the budget as
      // ordinary planned entries under synthetic ids. Deliberately not
      // summed here first: handing each one to `build_month` separately
      // means the totals and `unassigned` are still Rust's arithmetic, and
      // each commitment gets its own line to show, rather than the front
      // end doing money maths CLAUDE.md puts in the core.
      if (includeCommitments) {
        for (const goal of goals?.items ?? []) {
          const months = monthsBetween(todayIso(), goal.target_date);
          // eslint-disable-next-line no-await-in-loop
          const contribution = await wasmModule.required_contribution?.({
            target_amount: goal.target_amount,
            current_amount: goal.current_amount,
            months_remaining: months,
            cadence: 'monthly',
          });
          if (contribution?.amount > 0) {
            planned.push({ category_id: `${GOAL_PREFIX}${goal.id}`, amount: contribution.amount });
          }
        }
        for (const debt of debts?.items ?? []) {
          if (debt.min_payment > 0) {
            planned.push({ category_id: `${DEBT_PREFIX}${debt.id}`, amount: debt.min_payment });
          }
        }
      }

      const built = await wasmModule.build_month({
        planned,
        previous_remaining: [],
        spent,
        income_category_ids: incomeCategoryIds,
      });
      if (!cancelled) setResult(built);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [
    wasmModule,
    budgetPlan.items,
    categories.items,
    monthTransactions,
    includeCommitments,
    goals?.items,
    debts?.items,
  ]);

  /**
   * The Savings row's line: income minus every real expense category's
   * actual this month. Computed as its own `build_savings_line` call
   * rather than folded into `build_month` above, since it isn't a
   * category `build_month` knows about -- there's no `Category` record
   * and nothing is ever categorized against it (see savings.js).
   */
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.build_savings_line || !result?.summary) {
        setSavingsResult(null);
        return;
      }
      const planned =
        budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID)?.planned ?? 0;
      const expense = totalExpenseActual(result.lines ?? [], isIncome, isCommitmentId);
      const built = await wasmModule.build_savings_line({
        planned,
        income: result.summary.income,
        total_expense_actual: expense,
      });
      if (!cancelled) setSavingsResult(built);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, result, budgetPlan.items, categories.items]);

  const savingsLine = savingsResult?.line;

  /** Savings reads the opposite way `line.remaining` (planned minus
   *  actual) does for every other category, so this shows actual minus
   *  planned instead: meeting or beating the target is good news (green,
   *  "received more" -- saved more than planned), falling short is a
   *  plain negative amount still to go (red), the same polarity every
   *  other category's remaining already uses. */
  const savingsRemainingCell = (line) => {
    const gap = line.spent - line.planned;
    if (gap >= 0) {
      return {
        className: 'positive',
        text: t('budget.receivedMore', { amount: formatMoney(gap) }),
      };
    }
    return { className: 'negative', text: formatMoney(gap) };
  };

  const categoryFor = (id) => categories.items.find((c) => c.id === id);
  const categoryName = (id) => categories.items.find((c) => c.id === id)?.name ?? id;
  const categoryGroup = (id) => categories.items.find((c) => c.id === id)?.group ?? '';
  const categoryDescription = (id) => categories.items.find((c) => c.id === id)?.description ?? '';

  /**
   * Grouped for display, alphabetically within each group.
   *
   * Storage lists categories in id order, and ids are timestamp-plus-
   * random, so a seeded budget came back with its groups interleaved
   * (Home, Food, Home...) even though the presets are declared grouped.
   * `Category.group` is documented in budget-calc as carrying no
   * behaviour and existing only for display order -- this is that use.
   * Ordering for the eye is host-layer, hence `localeCompare` here rather
   * than a sort in Rust.
   */
  const orderedLines = useMemo(() => {
    const collator = new Intl.Collator(locale);
    return [...(result?.lines ?? [])]
      .filter((l) => !isCommitmentId(l.category_id))
      .sort((a, b) => {
        // Income first, as its own block, regardless of where "Income"
        // and "Expense" happen to fall alphabetically in the reader's
        // language -- `is_income` is the real signal, `group` (below) is
        // only for ordering within a side.
        const aIncome = isIncome(a.category_id);
        const bIncome = isIncome(b.category_id);
        if (aIncome !== bIncome) return aIncome ? -1 : 1;
        const byGroup = collator.compare(
          categoryGroup(a.category_id),
          categoryGroup(b.category_id),
        );
        return byGroup !== 0
          ? byGroup
          : collator.compare(categoryName(a.category_id), categoryName(b.category_id));
      });
  }, [result, categories.items, locale]);

  /** The goal/debt lines `build_month` returned, paired back with the
   *  record each one came from so it can be shown by name. */
  const commitmentLines = useMemo(
    () =>
      (result?.lines ?? [])
        .filter((l) => isCommitmentId(l.category_id))
        .map((line) => {
          const isGoal = line.category_id.startsWith(GOAL_PREFIX);
          const id = line.category_id.slice((isGoal ? GOAL_PREFIX : DEBT_PREFIX).length);
          const source = (isGoal ? goals?.items : debts?.items)?.find((r) => r.id === id);
          return { line, isGoal, name: source?.name ?? id };
        }),
    [result, goals?.items, debts?.items],
  );

  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCategory.name.trim()) return;
    const id = wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`;
    await categories.save({
      id,
      name: newCategory.name,
      group: newCategory.group || (newCategory.isIncome ? t('cat.group.income') : 'General'),
      is_income: newCategory.isIncome,
    });
    setNewCategory({ name: '', group: '', isIncome: false });
  };

  /**
   * Records spending -- or, against an income category, income -- without
   * leaving this tab.
   *
   * "Spent"/"Received" is derived -- `budget-calc::spend_by_category` and
   * `income_by_category` sum this month's negative or positive
   * transactions respectively -- so the only way to move it was the
   * Transactions tab, which nothing here said. This writes an ordinary
   * transaction; the Transactions tab lists it and can edit or delete it
   * exactly as if it had been typed there.
   *
   * The field asks for a plain positive amount and this applies the sign,
   * because asking a person to type a minus sign to record an expense (or
   * to remember an income category is the one place they shouldn't) is
   * the kind of trap that produces a confidently wrong budget: type 50 for
   * lunch without it and it books as income.
   */
  const logSpending = async (e, categoryId) => {
    e.preventDefault();
    const magnitude = Math.abs(Number(spendDraft.amount));
    if (!Number.isFinite(magnitude) || magnitude === 0) return;
    const id = wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`;
    await transactions.save({
      id,
      date: todayIso(),
      description: spendDraft.description.trim() || categoryName(categoryId),
      amount: isIncome(categoryId) ? magnitude : -magnitude,
      category_id: categoryId,
    });
    setSpendDraft({ amount: '', description: '' });
    setSpendFor(null);
  };

  const openSpend = (categoryId) => {
    setSpendDraft({ amount: '', description: '' });
    setSpendFor((current) => (current === categoryId ? null : categoryId));
  };

  const savePlanned = async (categoryId, amount) => {
    const existing = budgetPlan.items.find((p) => p.category_id === categoryId);
    const id = existing?.id ?? (wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`);
    await budgetPlan.save({
      id,
      month: viewMonth,
      category_id: categoryId,
      planned: Number(amount) || 0,
    });
  };

  /**
   * Every date this month a recurring expense is due -- rent, a
   * subscription, anything on a schedule -- computed in Rust so a weekly
   * bill genuinely counts 4 or 5 occurrences depending on the real
   * calendar rather than a flat estimate (see budget-calc::recurring's
   * doc comment for the actual user complaint this answers: wanting to
   * see scheduled expenses *before* they post, not after).
   */
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.recurring_occurrences || !(recurring?.items?.length > 0)) {
        setUpcoming(null);
        return;
      }
      const result = await wasmModule.recurring_occurrences({
        recurring: recurring.items,
        month: viewMonth,
      });
      if (!cancelled) setUpcoming(result);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, recurring?.items, viewMonth]);

  /** Adds a recurring category's expected total on top of whatever is
   *  already planned for it -- the one-click "help solve it" action, not
   *  just a number to notice and go type in by hand. */
  const addUpcomingToPlanned = async (categoryId, amount) => {
    const currentPlanned = budgetPlan.items.find((p) => p.category_id === categoryId)?.planned ?? 0;
    await savePlanned(categoryId, currentPlanned + amount);
  };

  /**
   * What the Remaining cell says and how it's styled -- three existing
   * expense-side cases (still exactly the wording/colour they were),
   * plus two income-side ones that read the same negative `remaining`
   * the opposite way: for an expense category running negative means
   * overspending (bad, red, "borrowed"); for an income category it means
   * more came in than was planned for (good, never red).
   */
  const remainingCell = (line) => {
    if (line.remaining >= 0) {
      return { className: 'positive', text: formatMoney(line.remaining) };
    }
    if (isIncome(line.category_id)) {
      return line.planned > 0
        ? {
            className: 'positive',
            text: t('budget.receivedMore', { amount: formatMoney(-line.remaining) }),
          }
        : {
            className: 'positive',
            text: t('budget.unplannedIncome', { amount: formatMoney(-line.remaining) }),
          };
    }
    return line.planned > 0
      ? {
          className: 'negative',
          text: t('budget.borrowed', { amount: formatMoney(-line.remaining) }),
        }
      : { className: 'muted-note', text: t('budget.unbudgetedSpend') };
  };

  const days = daysLeftInMonth();
  const summary = result?.summary;
  const unassigned = summary?.unassigned ?? 0;
  // "Every dollar has a job" used to show whenever unassigned was 0 --
  // which is vacuously true on an empty budget, so the first thing the app
  // ever said about someone's money was a congratulation for doing
  // nothing. A budget only counts as assigned once income exists and
  // something has actually been planned against it.
  const hasIncome = (summary?.income ?? 0) > 0;
  const hasBudget = hasIncome && (summary?.total_planned ?? 0) > 0;

  return (
    <div className="panel budget">
      <div className="dash-header">
        <MonthYearPicker
          value={viewMonth}
          onChange={setViewMonth}
          todayMonth={today}
          locale={locale}
        />
      </div>
      <p className="headline">
        {isCurrentMonth
          ? t('budget.daysLeft', { days, month: monthLabel(viewMonth, locale) })
          : isPastMonth
            ? t('budget.viewingPastMonth')
            : t('budget.viewingFutureMonth', { month: monthLabel(viewMonth, locale) })}
      </p>
      {/* The method, stated once. Zero-based budgeting is the entire
          premise of this tab and the UI never said what it was. */}
      <p className="panel-subtitle">{t('budget.method')}</p>

      {/* Off by default: a goal or debt only claims part of this month's
          income once someone says so, not because the feature exists. */}
      <label className="field-check commitments-toggle">
        <input
          type="checkbox"
          checked={includeCommitments}
          onChange={(e) => {
            setIncludeCommitments(e.target.checked);
            saveIncludeCommitments(e.target.checked);
          }}
        />
        <span>{t('budget.includeCommitments')}</span>
      </label>

      {result?.error && <CalcError result={result} />}
      {savingsResult?.error && <CalcError result={savingsResult} />}

      {summary && (
        <>
          {/* Unassigned is the whole activity of zero-based budgeting --
              you are done when it reaches zero -- so it leads, at the size
              that says so, and the three derived figures you can't act on
              sit underneath it. It used to be the fourth of four
              identical tiles, after three you don't act on at all. */}
          <div
            className={`assign-banner${hasBudget ? '' : ' assign-banner-start'}${unassigned < 0 ? ' assign-banner-over' : ''}`}
          >
            <span className="assign-label">
              {!hasIncome
                ? t('budget.startWithIncome')
                : !hasBudget
                  ? t('budget.assignPrompt', { amount: formatMoney(summary.income) })
                  : unassigned === 0
                    ? t('budget.fullyAssigned')
                    : unassigned > 0
                      ? t('budget.unassignedPositive', { amount: formatMoney(unassigned) })
                      : t('budget.unassignedNegative', { amount: formatMoney(-unassigned) })}
            </span>
            {hasIncome && <span className="assign-value">{formatMoney(unassigned)}</span>}
          </div>

          <div className="stat-grid stat-grid-secondary">
            <div className="stat">
              <span className="stat-label">
                {isCurrentMonth
                  ? t('budget.income')
                  : t('budget.incomeFor', { month: monthLabel(viewMonth, locale) })}
              </span>
              <span className="stat-value">{formatMoney(summary.income)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{t('budget.totalPlanned')}</span>
              <span className="stat-value">{formatMoney(summary.total_planned)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">{t('budget.totalSpent')}</span>
              <span className="stat-value">{formatMoney(summary.total_spent)}</span>
            </div>
          </div>
        </>
      )}

      {/* Framed entirely around "upcoming" -- only meaningful looking at
          the current or a future month, not one that's already over. */}
      {!isPastMonth && upcoming && upcoming.occurrences.length > 0 && (
        <div className="upcoming-panel">
          <h3 className="upcoming-title">{t('recurring.upcomingTitle')}</h3>
          <p className="panel-subtitle">{t('recurring.upcomingHint')}</p>
          <div className="upcoming-totals">
            {upcoming.totals_by_category.map((total) => (
              <div className="upcoming-total-row" key={total.category_id}>
                <span className="upcoming-total-name">{categoryName(total.category_id)}</span>
                <span className="upcoming-total-amount">{formatMoney(total.amount)}</span>
                <button
                  type="button"
                  className="btn secondary upcoming-add"
                  onClick={() => addUpcomingToPlanned(total.category_id, total.amount)}
                >
                  {t('recurring.addToPlanned')}
                </button>
              </div>
            ))}
          </div>
          <ul className="upcoming-list">
            {upcoming.occurrences.map((o, i) => (
              <li
                key={`${o.recurring_id}-${o.date}-${i}`}
                className={o.date < todayIso() ? 'past' : ''}
              >
                <span className="upcoming-date">{o.date}</span>
                <span className="upcoming-desc">{o.description}</span>
                <span className="upcoming-amount">{formatMoney(o.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {categories.items.length === 0 && !savingsLine ? (
        <p className="empty-state">{t('budget.noCategories')}</p>
      ) : (
        <div className="category-table">
          {/* Without these, Planned/Spent/Remaining read as three bare
              figures with nothing saying which is which. */}
          <div className="category-row category-head">
            <div>{t('budget.categoryName')}</div>
            <div className="num">{t('budget.planned')}</div>
            <div className="num">{t('budget.actual')}</div>
            <div className="num">{t('budget.remaining')}</div>
            <div />
          </div>
          {orderedLines.map((line, i) => {
            const incomeRow = isIncome(line.category_id);
            const remaining = remainingCell(line);
            // A section header once at the top of the income block and
            // once at the top of the expense block -- `orderedLines` is
            // already sorted income-first, so the boundary is just the
            // one spot the flag flips.
            const startsNewSection =
              i === 0 || incomeRow !== isIncome(orderedLines[i - 1].category_id);
            return (
              <React.Fragment key={line.category_id}>
                {startsNewSection && (
                  <div className="category-section-header">
                    {t(incomeRow ? 'cat.group.income' : 'cat.group.expense')}
                  </div>
                )}
                <div className="category-row">
                  <div>
                    <div className="category-name">
                      <CategoryBadge category={categoryFor(line.category_id)} />
                      {categoryName(line.category_id)}
                    </div>
                    <div className="category-group">{categoryGroup(line.category_id)}</div>
                    {/* Mei's (a CPA) examples of what belongs here -- present
                    on a preset category, blank on a hand-typed one, so
                    this only ever adds information, never an empty line
                    that reads as broken. */}
                    {categoryDescription(line.category_id) && (
                      <div className="category-description">
                        {categoryDescription(line.category_id)}
                      </div>
                    )}
                    {/* How far through the plan this category is, without
                    reading three numbers and doing the division. Only
                    once a plan exists -- a full bar on planned 0 would
                    read as "done" when it means "unbudgeted". Exceeding
                    plan is only styled as a warning on the expense side --
                    an income category clearing its plan is good news. */}
                    {line.planned > 0 && (
                      <div
                        className="progress"
                        role="img"
                        aria-label={t('budget.progressAria', {
                          name: categoryName(line.category_id),
                          spent: formatMoney(line.spent),
                          planned: formatMoney(line.planned),
                        })}
                      >
                        <span
                          className={
                            !incomeRow && line.spent > line.planned
                              ? 'progress-fill over'
                              : 'progress-fill'
                          }
                          style={{
                            width: `${Math.min(100, (line.spent / line.planned) * 100).toFixed(1)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="field-input planned-input">
                    <span className="cell-label">{t('budget.planned')}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      aria-label={`${t('budget.planned')} — ${categoryName(line.category_id)}`}
                      placeholder="0"
                      // Empty rather than a literal 0, so budgeting a category
                      // is one keystroke instead of select-then-replace --
                      // fourteen times over on a seeded budget.
                      value={plannedDraft[line.category_id] ?? (line.planned || '')}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setPlannedDraft((d) => ({ ...d, [line.category_id]: raw }));
                        savePlanned(line.category_id, raw);
                      }}
                    />
                  </div>
                  {/* The .cell-label spans are hidden once the header row is
                  visible; on a narrow screen the row stacks and they are
                  the only thing naming each figure. */}
                  <div className="num spent-cell">
                    <span className="cell-label">
                      {t(incomeRow ? 'budget.received' : 'budget.spent')}
                    </span>
                    <span className="spent-value">{formatMoney(line.spent)}</span>
                    {/* Logging spending always dates the transaction "today" --
                    doing that while viewing a different month would create
                    a transaction that silently never shows up in the
                    month on screen. Backfilling a past month, or planning
                    ahead for a future one, goes through the Transactions
                    tab's manual-add form instead, which takes an explicit
                    date. */}
                    {isCurrentMonth && (
                      <button
                        type="button"
                        className="spend-add"
                        aria-expanded={spendFor === line.category_id}
                        aria-label={`${t(incomeRow ? 'budget.logIncome' : 'budget.logSpending')} — ${categoryName(line.category_id)}`}
                        title={t(incomeRow ? 'budget.logIncome' : 'budget.logSpending')}
                        onClick={() => openSpend(line.category_id)}
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div className={`num ${remaining.className}`}>
                    <span className="cell-label">{t('budget.remaining')}</span>
                    {remaining.text}
                  </div>
                  <button className="btn ghost" onClick={() => removeCategory(line.category_id)}>
                    {t('budget.remove')}
                  </button>
                </div>
                {spendFor === line.category_id && (
                  <form className="spend-form" onSubmit={(e) => logSpending(e, line.category_id)}>
                    <label className="field">
                      <span className="field-label">
                        {t(incomeRow ? 'budget.incomeAmount' : 'budget.spendAmount')}
                      </span>
                      <div className="field-input">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          autoFocus
                          value={spendDraft.amount}
                          onChange={(e) => setSpendDraft({ ...spendDraft, amount: e.target.value })}
                        />
                      </div>
                    </label>
                    <label className="field">
                      <span className="field-label">{t('transactions.description')}</span>
                      <div className="field-input">
                        <input
                          value={spendDraft.description}
                          placeholder={categoryName(line.category_id)}
                          onChange={(e) =>
                            setSpendDraft({ ...spendDraft, description: e.target.value })
                          }
                        />
                      </div>
                    </label>
                    <button className="btn" type="submit">
                      {t('budget.save')}
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => setSpendFor(null)}
                    >
                      {t('confirm.cancel')}
                    </button>
                  </form>
                )}
              </React.Fragment>
            );
          })}
          {savingsLine && (
            <React.Fragment>
              <div className="category-row-divider" role="separator" />
              <div className="category-row category-row-savings">
                <div>
                  <div className="category-name">{t('budget.savings')}</div>
                  <div className="category-group">{t('budget.savingsHint')}</div>
                </div>
                <div className="field-input planned-input">
                  <span className="cell-label">{t('budget.planned')}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    aria-label={`${t('budget.planned')} — ${t('budget.savings')}`}
                    placeholder="0"
                    value={plannedDraft[SAVINGS_CATEGORY_ID] ?? (savingsLine.planned || '')}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setPlannedDraft((d) => ({ ...d, [SAVINGS_CATEGORY_ID]: raw }));
                      savePlanned(SAVINGS_CATEGORY_ID, raw);
                    }}
                  />
                </div>
                <div className="num spent-cell">
                  <span className="cell-label">{t('budget.savingsActual')}</span>
                  <span className="spent-value">{formatMoney(savingsLine.spent)}</span>
                </div>
                <div className={`num ${savingsRemainingCell(savingsLine).className}`}>
                  <span className="cell-label">{t('budget.remaining')}</span>
                  {savingsRemainingCell(savingsLine).text}
                </div>
                <div />
              </div>
            </React.Fragment>
          )}
        </div>
      )}
      {categories.items.length > 0 && <p className="field-label">{t('budget.spentHint')}</p>}

      {includeCommitments && commitmentLines.length > 0 && (
        <div className="category-table commitments-table">
          <div className="category-row category-head">
            <div>{t('budget.commitmentsTitle')}</div>
            <div className="num">{t('budget.planned')}</div>
            <div />
          </div>
          {commitmentLines.map(({ line, isGoal, name }) => (
            <div className="category-row" key={line.category_id}>
              <div>
                <div className="category-name">{name}</div>
                <div className="category-group">{isGoal ? t('goals.title') : t('debt.title')}</div>
              </div>
              <div className="num">
                <span className="cell-label">{t('budget.planned')}</span>
                {formatMoney(line.planned)}
              </div>
              <div />
            </div>
          ))}
        </div>
      )}

      {/* Where the money went, not where it came from -- an income
          category with a big "actual" would otherwise show up as the
          largest bar in a chart titled "where the month's money went". */}
      <SpendChart
        lines={orderedLines.filter((l) => !isIncome(l.category_id))}
        categoryName={categoryName}
        formatMoney={formatMoney}
      />

      <form className="form-grid" onSubmit={addCategory}>
        <label className="field">
          <span className="field-label">{t('budget.categoryName')}</span>
          <div className="field-input">
            <input
              value={newCategory.name}
              onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('budget.categoryGroup')}</span>
          <div className="field-input">
            <input
              value={newCategory.group}
              onChange={(e) => setNewCategory({ ...newCategory, group: e.target.value })}
            />
          </div>
        </label>
        <label className="field field-check">
          <input
            type="checkbox"
            checked={newCategory.isIncome}
            onChange={(e) => setNewCategory({ ...newCategory, isIncome: e.target.checked })}
          />
          <span>{t('budget.categoryIsIncome')}</span>
        </label>
        <button className="btn" type="submit">
          {t('budget.addCategory')}
        </button>
        <button className="btn secondary" type="button" onClick={addCommonCategories}>
          {t('budget.addCommon')}
        </button>
      </form>
      <p className="field-label">{t('budget.commonHint')}</p>
    </div>
  );
}
