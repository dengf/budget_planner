//! Record types stored locally. Each mirrors the corresponding
//! `budget-calc` type but adds a `month` (for `Transaction`/`CategoryPlan`)
//! or is otherwise storage-shaped -- `budget-calc` itself has no idea
//! these are persisted at all, matching how `mortgage-ports::Scenario`
//! knows nothing about `mortgage-calc`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CategoryRecord {
    pub id: String,
    pub name: String,
    pub group: String,
}

/// One category's planned amount for one month. `month` is `YYYY-MM`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BudgetPlanRecord {
    pub id: String,
    pub month: String,
    pub category_id: String,
    pub planned: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransactionRecord {
    pub id: String,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoalRecord {
    pub id: String,
    pub name: String,
    pub target_amount: String,
    pub current_amount: String,
    pub target_date: String,
    pub cadence: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebtRecord {
    pub id: String,
    pub name: String,
    pub balance: String,
    pub apr: String,
    pub min_payment: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CategorizationRuleRecord {
    pub id: String,
    pub keyword: String,
    pub category_id: String,
    pub priority: i32,
}
