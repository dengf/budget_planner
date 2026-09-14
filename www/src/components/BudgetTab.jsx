import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { daysLeftInMonth, monthLabel } from '../month';
import CalcError from './CalcError';
import CategoryBadge from './CategoryBadge';
import SpendChart from './SpendChart';
import AssignBlossom from './AssignBlossom';
import EditPlanSheet from './EditPlanSheet';
import { isCommitmentId, loadIncludeCommitments } from '../commitments';
import { ASSIGN, budgetMode } from '../budgetMode';
import {
  categoryDisplayDescription,
  categoryDisplayGroup,
  categoryDisplayName,
} from '../presetCategories';
import { categoryColor } from '../categoryVisuals';
import { useMonthBudget } from '../useMonthBudget';

/**
 * `previous_remaining` (rollover) is passed as `[]` -- every month is
 * planned independently for now. `budget-calc::build_month` already
 * accepts a prior month's remaining balances; wiring the frontend to
 * carry them forward month-over-month is real, sizeable state (finding
 * and summing the actual previous month) left for a follow-up round
 * rather than this one.
 *
 * The row list here is read-and-tap, not read-and-type: a row shows a
 * badge, its name, a "spent of planned" bar and a remaining pill, and
 * tapping it opens `EditPlanSheet` -- the same bottom-sheet idiom the
 * `+` introduced -- rather than an inline input in a four-column grid.
 * Category management (add/rename/remove), the goals/debt commitments
 * toggle and the Savings target all moved to More's "Categories" screen
 * (`CategoriesScreen.jsx`); this tab now holds only the assign banner
 * and the list itself, per the plan's own ledger for this round.
 */
export default function BudgetTab({
  wasmModule,
  currencySymbol,
  today,
  viewMonth,
  categories,
  transactions,
  budgetPlan,
  goals,
  debts,
  recurring,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [editingId, setEditingId] = useState(null);
  const [upcoming, setUpcoming] = useState(null);
  // Read-only here: the checkbox that sets this now lives in
  // CategoriesScreen (More). This tab remounts (App.jsx's `key={activeTab}`
  // on the tab panel) every time someone switches to it, so it always
  // picks up whatever that screen last saved -- no live-sync needed
  // between two components that are never mounted at once.
  const [includeCommitments] = useState(() => loadIncludeCommitments());

  const isCurrentMonth = viewMonth === today;
  const isPastMonth = viewMonth < today;

  const { result, isIncome } = useMonthBudget({
    wasmModule,
    categories,
    budgetPlan,
    transactions,
    viewMonth,
    includeCommitments,
    goals,
    debts,
  });

  const categoryFor = (id) => categories.items.find((c) => c.id === id);
  const categoryName = (id) => {
    const c = categoryFor(id);
    return c ? categoryDisplayName(c, t) : id;
  };
  const categoryGroup = (id) => categoryDisplayGroup(categoryFor(id), t);
  const categoryDescription = (id) => categoryDisplayDescription(categoryFor(id), t);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `isIncome`/`categoryGroup`/`categoryName` are derived fresh each render from `categories.items`, already a dep below.
  }, [result, categories.items, locale]);

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
   * calendar rather than a flat estimate. Only the per-category totals
   * are kept: the itemized list this used to render in a standalone
   * "Upcoming" section now surfaces contextually, inside the sheet for
   * the one category being edited (see EditPlanSheet's `upcoming` prop).
   */
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (isPastMonth || !wasmModule?.recurring_occurrences || !(recurring?.items?.length > 0)) {
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
  }, [wasmModule, recurring?.items, viewMonth, isPastMonth]);

  /**
   * What the pill says and how it's styled. Expense rows use the plan's
   * own terse wording ("$42 over" / "$780 left") rather than a longer
   * sentence -- it's read a dozen-plus times per screen, once per row.
   * Income rows keep a plain figure ("$3,000.00", no "left") since a
   * planned-but-not-yet-received income category isn't money "left" to
   * spend; the two income-only cases below read the same negative
   * `remaining` the opposite way an expense would (more came in than
   * planned is good news, never red).
   */
  const remainingCell = (line) => {
    const incomeRow = isIncome(line.category_id);
    if (line.remaining >= 0) {
      return {
        className: 'positive',
        text: incomeRow
          ? formatMoney(line.remaining)
          : t('budget.pillLeft', { amount: formatMoney(line.remaining) }),
      };
    }
    if (incomeRow) {
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
          text: t('budget.pillOver', { amount: formatMoney(-line.remaining) }),
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
  // Distinct from `hasIncome` (which needs a planned amount, not just the
  // category) -- `budget.startWithIncome`'s "plan how much you expect
  // from each income category below" only makes sense once one exists to
  // plan against. On a genuinely empty budget there's nothing "below"
  // yet, so that message pointed at categories that didn't exist; this
  // flag picks the one that instead says where to add the first one.
  const hasIncomeCategory = categories.items.some((c) => c.is_income);
  const mode = budgetMode({ isPastMonth, hasIncome, unassigned });
  // Every fresh or cleared budget lands on the compact five-category
  // starter set at once, not an empty list -- so the assign banner's
  // "start with income" message applies to one specific row out of five
  // (and more once someone adds from the full catalogue), not something
  // the eye finds on its own. Dimming the Expense side (rows and its
  // section header) until an income category has something planned turns
  // that instruction into a visual one instead. `:focus-within` (main.css)
  // restores full opacity, so nothing here is actually harder to reach,
  // and this never applies to a past month -- reviewing history isn't
  // "start here" guidance.
  const dimExpenseUntilIncome = mode === ASSIGN && !hasIncome;

  const editingLine = orderedLines.find((l) => l.category_id === editingId);
  const editingUpcoming = upcoming?.totals_by_category?.find(
    (tot) => tot.category_id === editingId,
  );

  return (
    <div className="panel budget">
      <p className="headline">
        {isCurrentMonth
          ? t('budget.daysLeft', { days, month: monthLabel(viewMonth, locale) })
          : isPastMonth
            ? t('budget.viewingPastMonth')
            : t('budget.viewingFutureMonth', { month: monthLabel(viewMonth, locale) })}
      </p>

      {result?.error && <CalcError result={result} />}

      {summary && (
        <>
          {/* Unassigned is the whole activity of zero-based budgeting --
              you are done when it reaches zero -- so it leads, at the size
              that says so, and the three derived figures you can't act on
              sit underneath it. */}
          <div
            className={`assign-banner${hasBudget ? '' : ' assign-banner-start'}${unassigned < 0 ? ' assign-banner-over' : ''}`}
          >
            <AssignBlossom state={!hasIncome ? 'start' : unassigned < 0 ? 'over' : 'onTrack'} />
            <div className="assign-banner-text">
              <span className="assign-label">
                {!hasIncomeCategory
                  ? t('budget.startWithIncomeCategory')
                  : !hasIncome
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

      {categories.items.length === 0 ? (
        <p className="empty-state">{t('budget.noCategories')}</p>
      ) : (
        <div className="budget-rows">
          {orderedLines.map((line, i) => {
            const incomeRow = isIncome(line.category_id);
            const remaining = remainingCell(line);
            const over = !incomeRow && line.spent > line.planned;
            // A section header once at the top of the income block and
            // once at the top of the expense block -- `orderedLines` is
            // already sorted income-first, so the boundary is just the
            // one spot the flag flips.
            const startsNewSection =
              i === 0 || incomeRow !== isIncome(orderedLines[i - 1].category_id);
            const dimmed = dimExpenseUntilIncome && !incomeRow;
            return (
              <React.Fragment key={line.category_id}>
                {startsNewSection && (
                  <div
                    className={
                      dimmed
                        ? 'category-section-header category-section-dim'
                        : 'category-section-header'
                    }
                  >
                    {t(incomeRow ? 'cat.group.income' : 'cat.group.expense')}
                  </div>
                )}
                <button
                  type="button"
                  className={`budget-row${dimmed ? ' category-row-dim' : ''}`}
                  aria-label={t('budget.progressAria', {
                    name: categoryName(line.category_id),
                    spent: formatMoney(line.spent),
                    planned: formatMoney(line.planned),
                  })}
                  onClick={() => setEditingId(line.category_id)}
                >
                  <CategoryBadge category={categoryFor(line.category_id)} />
                  <span className="budget-row-body">
                    <span className="budget-row-top">
                      <span className="budget-row-name">{categoryName(line.category_id)}</span>
                      <span className={`budget-row-pill ${remaining.className}`}>
                        {remaining.text}
                      </span>
                    </span>
                    {line.planned > 0 && (
                      <span className="budget-row-track">
                        <span
                          className={`budget-row-bar${over ? ' over' : ''}`}
                          style={{
                            width: `${Math.min(100, (line.spent / line.planned) * 100).toFixed(1)}%`,
                            ...(over
                              ? {}
                              : { background: categoryColor(categoryFor(line.category_id)) }),
                          }}
                        />
                      </span>
                    )}
                    <span className="budget-row-sub">
                      {t('budget.rowSubtext', {
                        spent: formatMoney(line.spent),
                        planned: formatMoney(line.planned),
                      })}
                    </span>
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
      {categories.items.length > 0 && <p className="field-label">{t('budget.spentHint')}</p>}

      {editingLine && (
        <EditPlanSheet
          open={Boolean(editingLine)}
          onClose={() => setEditingId(null)}
          title={categoryName(editingLine.category_id)}
          badge={<CategoryBadge category={categoryFor(editingLine.category_id)} />}
          subtitle={
            categoryGroup(editingLine.category_id) +
            (categoryDescription(editingLine.category_id)
              ? ` · ${categoryDescription(editingLine.category_id)}`
              : '')
          }
          planned={editingLine.planned}
          spentLabel={t(isIncome(editingLine.category_id) ? 'budget.received' : 'budget.spent')}
          spent={editingLine.spent}
          remaining={remainingCell(editingLine)}
          upcoming={editingUpcoming}
          formatMoney={formatMoney}
          onSave={(amount) => savePlanned(editingLine.category_id, amount)}
        />
      )}

      {/* Where the money went, not where it came from -- an income
          category with a big "actual" would otherwise show up as the
          largest bar in a chart titled "where the month's money went". */}
      <SpendChart
        lines={orderedLines.filter((l) => !isIncome(l.category_id))}
        categoryName={categoryName}
        formatMoney={formatMoney}
      />
    </div>
  );
}
