// What the app becomes when the calculator engine cannot be loaded.
//
// Same principle as mortgage_calculator's unavailable.js: report the
// failure and compute nothing, rather than a second JavaScript
// implementation of the budgeting math that could silently disagree with
// the tested Rust one.
export function createUnavailableModule() {
  console.warn('Calculator engine unavailable - run `npm run build:wasm`.');

  const unavailable = () => ({
    error: 'The calculator engine could not be loaded.',
    error_message: { code: 'err.engineUnavailable', params: {}, text: 'The calculator engine could not be loaded.' },
  });

  // One in-memory collection per storage function, keyed the same way
  // budget-ext-redb keys its tables -- by record id. Not persisted: a
  // missing engine already means nothing works reliably, and pretending
  // otherwise across a reload would be worse than losing it on refresh.
  function inMemoryCollection() {
    let records = [];
    let seq = 0;
    return {
      async save(record) {
        const id = record.id || `local-${seq++}`;
        records = records.filter((r) => r.id !== id);
        records.push({ ...record, id });
        return { id, error: null };
      },
      async list() {
        return records;
      },
      async delete(id) {
        records = records.filter((r) => r.id !== id);
        return { success: true, error: null };
      },
    };
  }

  const categories = inMemoryCollection();
  const transactions = inMemoryCollection();
  const goals = inMemoryCollection();
  const debts = inMemoryCollection();
  const budgetPlan = inMemoryCollection();
  const rules = inMemoryCollection();

  return {
    build_month: unavailable,
    spend_by_category: unavailable,
    income_by_category: unavailable,
    daily_spend: unavailable,
    apply_rules: unavailable,
    import_csv: unavailable,
    detect_csv_columns: () => ({ mapping: null }),
    goal_progress: unavailable,
    milestone_crossed: unavailable,
    required_contribution: unavailable,
    build_payoff_plan: unavailable,
    new_id: () => `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,

    init_storage: async () => {},
    save_category: (dto) => categories.save(dto),
    list_categories: () => categories.list(),
    delete_category: (id) => categories.delete(id),
    save_transaction: (dto) => transactions.save(dto),
    list_transactions: () => transactions.list(),
    delete_transaction: (id) => transactions.delete(id),
    save_goal: (dto) => goals.save(dto),
    list_goals: () => goals.list(),
    delete_goal: (id) => goals.delete(id),
    save_debt: (dto) => debts.save(dto),
    list_debts: () => debts.list(),
    delete_debt: (id) => debts.delete(id),
    save_budget_plan_entry: (dto) => budgetPlan.save(dto),
    list_budget_plan: async (month) => (await budgetPlan.list()).filter((r) => r.month === month),
    delete_budget_plan_entry: (id) => budgetPlan.delete(id),
    save_rule: (dto) => rules.save(dto),
    list_rules: () => rules.list(),
    delete_rule: (id) => rules.delete(id),
  };
}
