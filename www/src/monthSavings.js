import { useEffect, useState } from 'react';
import { SAVINGS_CATEGORY_ID, totalExpenseActual } from './savings';

/**
 * This month's Savings figure -- the one the Dashboard shows -- for a
 * screen that isn't the Dashboard.
 *
 * Savings is a residual, not a category money is filed against: income
 * minus every real expense category's actual. That subtraction lives in
 * `budget_calc::build_savings_line`, and getting at it needs the month
 * built first, so this hook makes the same two wasm calls the Dashboard
 * makes (`build_month`, then `build_savings_line`) and returns only the
 * number. No arithmetic happens here -- every figure below comes back
 * from Rust; this is the call sequence, not a second implementation of
 * it. `DashboardTab` runs the same sequence inline instead of calling
 * this because it also needs the intermediate `lines` for its donut and
 * its ranked rows; this hook is for callers that want the residual and
 * nothing else.
 *
 * Returns `null` until the answer is known, so a caller can tell "no
 * savings yet" (the engine hasn't loaded, or the month has no plan)
 * apart from "savings is zero".
 */
export function useMonthSavings({ wasmModule, transactions, categories, budgetPlan, viewMonth }) {
  const [savings, setSavings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (
        !wasmModule?.spend_by_category ||
        !wasmModule?.income_by_category ||
        !wasmModule?.build_month ||
        !wasmModule?.build_savings_line ||
        categories.items.length === 0
      ) {
        if (!cancelled) setSavings(null);
        return;
      }
      const monthTx = transactions.items.filter((tx) => tx.date?.startsWith(viewMonth));
      const isIncome = (id) => categories.items.find((c) => c.id === id)?.is_income ?? false;

      // Same split as the Dashboard's: an income category's "actual" is
      // what it received, an expense category's is what it cost.
      const [spendResult, incomeResult] = await Promise.all([
        wasmModule.spend_by_category({ transactions: monthTx }),
        wasmModule.income_by_category({ transactions: monthTx }),
      ]);
      const spent = [
        ...(spendResult?.totals ?? []).filter((row) => !isIncome(row.category_id)),
        ...(incomeResult?.totals ?? []).filter((row) => isIncome(row.category_id)),
      ].map((r) => ({ category_id: r.category_id, amount: r.amount }));

      // Every known category, defaulting to 0 planned -- not
      // `budgetPlan.items` alone, for the reason CLAUDE.md documents
      // under "A new category has no budget-plan entry until one is
      // saved".
      const planned = categories.items.map((c) => ({
        category_id: c.id,
        amount: budgetPlan.items.find((p) => p.category_id === c.id)?.planned ?? 0,
      }));
      const incomeCategoryIds = categories.items.filter((c) => c.is_income).map((c) => c.id);

      const built = await wasmModule.build_month({
        planned,
        previous_remaining: [],
        spent,
        income_category_ids: incomeCategoryIds,
      });
      const lines = built?.lines ?? [];
      if (lines.length === 0) {
        if (!cancelled) setSavings(null);
        return;
      }

      const line = await wasmModule.build_savings_line({
        planned: budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID)?.planned ?? 0,
        income: built?.summary?.income ?? 0,
        total_expense_actual: totalExpenseActual(lines, isIncome, () => false),
      });
      if (!cancelled) setSavings(line?.line?.spent ?? null);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, transactions.items, categories.items, budgetPlan.items, viewMonth]);

  return savings;
}
