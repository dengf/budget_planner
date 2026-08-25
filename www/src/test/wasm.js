/**
 * A stub wasm module for component tests.
 *
 * These stand in for the real bindings so a component's own wiring can be
 * asserted without a wasm32 build. The actual math is tested where it
 * lives -- crates/budget-calc's unit tests -- these mirror only the
 * *shape* of a response.
 */
export function stubWasm(overrides = {}) {
  return {
    new_id: () => 'test-id',
    build_month: async ({ income = 0, planned = [], spent = [] } = {}) => {
      const lines = planned.map((p) => {
        const s = spent.find((x) => x.category_id === p.category_id)?.amount ?? 0;
        return { category_id: p.category_id, planned: p.amount, rollover: 0, spent: s, remaining: p.amount - s };
      });
      const total_planned = planned.reduce((a, p) => a + p.amount, 0);
      const total_spent = lines.reduce((a, l) => a + l.spent, 0);
      return { lines, summary: { income, total_planned, total_spent, unassigned: income - total_planned }, error: null };
    },
    spend_by_category: async ({ transactions = [] } = {}) => {
      const totals = {};
      for (const t of transactions) {
        if (!t.category_id || t.amount >= 0) continue;
        totals[t.category_id] = (totals[t.category_id] ?? 0) + -t.amount;
      }
      return { totals: Object.entries(totals).map(([category_id, amount]) => ({ category_id, amount })), error: null };
    },
    apply_rules: async ({ transactions = [] } = {}) => ({ transactions, error: null }),
    import_csv: async () => ({ imported: [], skipped: [], error: null }),
    goal_progress: async ({ current_amount = 0, target_amount = 1 } = {}) => ({
      ratio: Math.min(1, current_amount / target_amount),
      petals_filled: Math.min(5, Math.floor((current_amount / target_amount) * 5)),
      error: null,
    }),
    milestone_crossed: async () => ({ milestone: null, error: null }),
    required_contribution: async () => ({ amount: 0, error: null }),
    build_payoff_plan: async ({ debts = [] } = {}) => ({
      order: debts.map((d) => d.id),
      schedule: [],
      months_to_debt_free: 0,
      total_interest: 0,
      error: null,
    }),
    init_storage: async () => {},
    ...overrides,
  };
}
