import { useEffect, useMemo, useState } from 'react';

/**
 * Which categories to put in front of someone adding a transaction, and
 * which one (if any) is worth pre-selecting.
 *
 * The ordering itself is `budget_calc::category_rank` -- direction first
 * (money received can only be an income category), then recency-weighted
 * frequency. None of that arithmetic lives here; this only holds the
 * call, the loading state, and the fallback for the window before wasm
 * has finished loading.
 *
 * `suggestionId` is deliberately null until there is a reason: a
 * category earns a pre-selection by having actually been used before
 * (`uses > 0`), never by merely sorting first in a list nobody has
 * picked from yet. Filing a transaction under a category the person
 * never chose, because it happened to be alphabetically lucky, is the
 * kind of quietly-wrong record this app exists not to produce.
 */
export function useCategoryRank({ wasmModule, categories, transactions, today, isIncome }) {
  const [ranked, setRanked] = useState(null);
  const direction = isIncome ? 'income' : 'expense';

  // Before wasm resolves -- and if `category_rank` ever fails -- the
  // direction filter alone still gives a usable, correctly-ordered list,
  // so the picker is never empty and never shows the wrong side of the
  // ledger. It just isn't sorted by habit yet.
  const matching = useMemo(
    () => categories.filter((c) => Boolean(c.is_income) === isIncome),
    [categories, isIncome],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = wasmModule?.category_rank
        ? await wasmModule.category_rank({
            categories,
            transactions,
            as_of: today,
            direction,
          })
        : null;
      if (!cancelled) setRanked(result?.error ? null : (result?.ranked ?? null));
    })();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, categories, transactions, today, direction]);

  return useMemo(() => {
    if (!ranked) return { ordered: matching, suggestionId: null };
    const byId = new Map(matching.map((c) => [c.id, c]));
    const ordered = ranked.map((r) => byId.get(r.category_id)).filter(Boolean);
    const top = ranked[0];
    return {
      ordered,
      suggestionId: top && top.uses > 0 && byId.has(top.category_id) ? top.category_id : null,
    };
  }, [ranked, matching]);
}
