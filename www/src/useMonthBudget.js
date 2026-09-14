import { useEffect, useMemo, useState } from 'react';
import { monthsBetween, todayIso } from './month';
import { DEBT_PREFIX, GOAL_PREFIX } from './commitments';

/**
 * `budget_calc::build_month` for one month, shared by BudgetTab (the row
 * list) and CategoriesScreen (the Savings row and the commitments table
 * both need the same `result.summary`/`result.lines` this produces) --
 * one call site instead of two independent copies of the trap below.
 *
 * CLAUDE.md documents this as a real shipped bug: the planned list must
 * be built from every known category, defaulting to 0, never from
 * `budgetPlan.items` alone -- the latter makes a freshly-added category
 * (or, here, one of the five starter categories before anyone has typed
 * an amount) invisible until something else creates a plan row for it.
 * Keeping this in one hook means that trap can only be reintroduced once,
 * not once per caller.
 */
export function useMonthBudget({
  wasmModule,
  categories,
  budgetPlan,
  transactions,
  viewMonth,
  includeCommitments,
  goals,
  debts,
}) {
  const [result, setResult] = useState(null);
  const isIncome = (id) => categories.items.find((c) => c.id === id)?.is_income ?? false;

  const monthTransactions = useMemo(
    () => transactions.items.filter((tx) => tx.date?.startsWith(viewMonth)),
    [transactions.items, viewMonth],
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `isIncome` is derived fresh each render from `categories.items`, already a dep below.
  }, [
    wasmModule,
    budgetPlan.items,
    categories.items,
    monthTransactions,
    includeCommitments,
    goals?.items,
    debts?.items,
  ]);

  return { result, isIncome, monthTransactions };
}
