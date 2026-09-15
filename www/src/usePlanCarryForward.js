import { useCallback, useEffect, useState } from 'react';

/**
 * The month boundary, from the new month's side.
 *
 * A budget plan is stored per `YYYY-MM`, so a fresh month starts with no
 * rows at all and every planned amount had to be re-typed from memory --
 * twelve times a year, for the same figures. This hook answers "is there
 * an earlier plan to start from?" and, on request, writes it into the
 * month on screen.
 *
 * Both decisions it depends on are Rust's, not this file's:
 * `previous_plan_month` picks which earlier month to offer (most recent
 * one that has rows, never this month or a later one) and
 * `carry_plan_forward` decides which of its rows survive the copy. What's
 * left here is storage plumbing -- reading that month's rows, and saving
 * the result under fresh ids against the month being viewed.
 */
export function usePlanCarryForward({ wasmModule, budgetPlan, categories, viewMonth }) {
  const [previousPlanMonth, setPreviousPlanMonth] = useState(null);
  const [carrying, setCarrying] = useState(false);

  // Deliberately not keyed on `budgetPlan.items`: saving rows *into* the
  // month on screen can't change which *earlier* month has a plan, and
  // depending on it would re-ask once per row written during a carry.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.previous_plan_month) return;
      const result = await wasmModule.previous_plan_month(viewMonth);
      if (!cancelled) setPreviousPlanMonth(result?.month ?? null);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, viewMonth]);

  const carryPlanForward = useCallback(async () => {
    if (!wasmModule?.carry_plan_forward || !wasmModule?.list_budget_plan || !previousPlanMonth) {
      return { carried: 0 };
    }
    setCarrying(true);
    try {
      const previous = await wasmModule.list_budget_plan(previousPlanMonth);
      const carried = await wasmModule.carry_plan_forward({
        previous: (previous ?? []).map((p) => ({
          category_id: p.category_id,
          planned: p.planned,
        })),
        existing_category_ids: categories.items.map((c) => c.id),
      });
      const entries = carried?.entries ?? [];
      for (const entry of entries) {
        // Reuse this month's existing row for the category when there is
        // one -- someone can have typed a single amount before taking the
        // offer, and a second row for the same category is a state the
        // rest of the app has no reading for (`budgetPlan.items.find()`
        // would take one and orphan the other).
        const existing = budgetPlan.items.find((p) => p.category_id === entry.category_id);
        await budgetPlan.save({
          id: existing?.id ?? wasmModule.new_id(),
          month: viewMonth,
          category_id: entry.category_id,
          planned: entry.planned,
        });
      }
      return { carried: entries.length };
    } finally {
      setCarrying(false);
    }
  }, [wasmModule, previousPlanMonth, categories.items, budgetPlan, viewMonth]);

  return { previousPlanMonth, carryPlanForward, carrying };
}
