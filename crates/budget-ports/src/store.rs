use async_trait::async_trait;

use crate::error::StoreError;
use crate::records::{
    BudgetPlanRecord, CategorizationRuleRecord, CategoryRecord, DebtRecord, GoalRecord,
    TransactionRecord,
};

/// Local persistence for everything the budget planner keeps: categories,
/// one month's plan at a time, transactions, goals, debts and
/// categorization rules.
///
/// `?Send` for the same reason as `mortgage-ports::ScenarioStore`: futures
/// on `wasm32-unknown-unknown` generally aren't `Send`, and this trait
/// must be implementable by a wasm-backed store.
///
/// One save/list/delete triple per record type rather than a single
/// generic method — `budget-wasm` needs a distinct, named wasm-bindgen
/// export per collection anyway (JS calls functions by name), so a
/// generic port here would just be erased at the next layer up.
#[async_trait(?Send)]
pub trait BudgetStore {
    async fn save_category(&self, record: CategoryRecord) -> Result<(), StoreError>;
    async fn list_categories(&self) -> Result<Vec<CategoryRecord>, StoreError>;
    async fn delete_category(&self, id: &str) -> Result<(), StoreError>;

    async fn save_budget_plan(&self, record: BudgetPlanRecord) -> Result<(), StoreError>;
    /// Every planned-amount line for one `YYYY-MM` month.
    async fn list_budget_plan(&self, month: &str) -> Result<Vec<BudgetPlanRecord>, StoreError>;
    async fn delete_budget_plan(&self, id: &str) -> Result<(), StoreError>;

    async fn save_transaction(&self, record: TransactionRecord) -> Result<(), StoreError>;
    /// All transactions, newest first. Filtering to a month or category is
    /// a host-layer concern (it's cheap, in-memory, and every consumer
    /// wants a different slice) -- see CLAUDE.md's rule on where a thing
    /// goes.
    async fn list_transactions(&self) -> Result<Vec<TransactionRecord>, StoreError>;
    async fn delete_transaction(&self, id: &str) -> Result<(), StoreError>;

    async fn save_goal(&self, record: GoalRecord) -> Result<(), StoreError>;
    async fn list_goals(&self) -> Result<Vec<GoalRecord>, StoreError>;
    async fn delete_goal(&self, id: &str) -> Result<(), StoreError>;

    async fn save_debt(&self, record: DebtRecord) -> Result<(), StoreError>;
    async fn list_debts(&self) -> Result<Vec<DebtRecord>, StoreError>;
    async fn delete_debt(&self, id: &str) -> Result<(), StoreError>;

    async fn save_rule(&self, record: CategorizationRuleRecord) -> Result<(), StoreError>;
    async fn list_rules(&self) -> Result<Vec<CategorizationRuleRecord>, StoreError>;
    async fn delete_rule(&self, id: &str) -> Result<(), StoreError>;
}
