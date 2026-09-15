import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The log-first on-ramp: a budget proposed from what someone has already
 * spent.
 *
 * A first-time budgeter does not know their grocery number, so the setup
 * ladder's "plan your income, then assign it" asks them to invent one.
 * Plenty of people log transactions for weeks instead and never plan at
 * all -- their own history is a better answer than anything they would
 * type from memory, and it is sitting right there.
 *
 * Every figure below is `budget_calc::suggest_plan_from_spending`'s:
 * which months are worth reading, how much history is enough, the
 * per-month averages, the rounding, and what the leftover becomes. This
 * file passes the whole transaction list over and writes back whatever
 * comes out -- deliberately not a pre-filtered month or a JS `reduce`,
 * because each of those choices changes the numbers a person then budgets
 * against.
 *
 * `incomeOverride` is the one thing history cannot answer for someone who
 * only ever logs spending. The sheet collects it, and it goes *back into
 * Rust* rather than being added to a total here, so the savings arithmetic
 * still happens in exactly one place.
 */
export function usePlanFromSpending({
  wasmModule,
  transactions,
  categories,
  budgetPlan,
  viewMonth,
}) {
  // Stamped with the month it was typed for, and discarded on sight if
  // the viewer has moved on. Deliberately not cleared by an effect
  // watching `viewMonth`: that leaves one render in which September's
  // figure is still live on October's screen, which is one render longer
  // than a wrong income number should exist.
  const [typedIncome, setTypedIncome] = useState(null);
  // Memoized because it is an effect dependency below: a fresh object
  // every render would re-run the suggestion on every render, not on
  // every change.
  const incomeOverride = useMemo(
    () =>
      typedIncome?.month === viewMonth
        ? { category_id: typedIncome.category_id, planned: typedIncome.planned }
        : null,
    [typedIncome, viewMonth],
  );
  const setIncomeOverride = useCallback(
    (entry) => setTypedIncome(entry ? { ...entry, month: viewMonth } : null),
    [viewMonth],
  );

  const [suggestion, setSuggestion] = useState(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.suggest_plan_from_spending) return;
      const result = await wasmModule.suggest_plan_from_spending({
        transactions: transactions.items,
        categories: categories.items,
        plan_month: viewMonth,
        income_override: incomeOverride,
      });
      if (!cancelled) setSuggestion(result?.error ? null : result);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, transactions.items, categories.items, viewMonth, incomeOverride]);

  const applyPlan = useCallback(async () => {
    // `entries` is empty unless the suggestion is ready, so a caller that
    // saves without checking the state writes nothing rather than half a
    // budget. See `SuggestedPlan::entries`.
    const entries = suggestion?.entries ?? [];
    if (entries.length === 0) return { written: 0 };
    setApplying(true);
    try {
      for (const entry of entries) {
        // Reuse this month's existing row for the category when there is
        // one -- the same rule `usePlanCarryForward` applies, and for the
        // same reason: two plan rows for one category is a state the rest
        // of the app has no reading for.
        const existing = budgetPlan.items.find((p) => p.category_id === entry.category_id);
        await budgetPlan.save({
          id: existing?.id ?? wasmModule.new_id(),
          month: viewMonth,
          category_id: entry.category_id,
          planned: entry.planned,
        });
      }
      return { written: entries.length };
    } finally {
      setApplying(false);
    }
  }, [suggestion, budgetPlan, viewMonth, wasmModule]);

  // Whether to offer at all. `no_income_observed` counts -- the sheet has
  // rows to show and one question to ask, which beats silence.
  //
  // The month having *any* planned amount already withdraws the offer,
  // and that guard lives here rather than at each entry point on purpose:
  // `applyPlan` writes over the existing row for a category (it must --
  // two rows for one category is a state nothing else can read), so an
  // offer shown to someone who has typed even one figure is an offer to
  // silently replace it. A stricter test than the Budget tab's own
  // `hasBudget`, which is satisfied only once income *and* an expense are
  // planned and so would leave a half-typed plan exposed.
  const canOffer =
    !budgetPlan.items.some((p) => (p.planned ?? 0) > 0) &&
    (suggestion?.state === 'ready' || suggestion?.state === 'no_income_observed');

  return { suggestion, canOffer, incomeOverride, setIncomeOverride, applyPlan, applying };
}
