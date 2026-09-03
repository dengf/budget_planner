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
    /// Added after this record shape was already in use -- `#[serde(default)]`
    /// so a category saved before this field existed deserializes as an
    /// expense category (`false`) rather than failing to load at all.
    #[serde(default)]
    pub is_income: bool,
    /// Same back-compat reasoning as `is_income` above.
    #[serde(default)]
    pub description: String,
    /// Which starter preset (e.g. `"cat.housing"`) this category was
    /// created from, if any -- `None` for a hand-typed category. Purely
    /// decorative (which icon/color the frontend shows), same as `group`
    /// above: never matched on for behaviour. Stored so the icon survives
    /// a rename or a later locale switch, since `name` itself is
    /// translated text frozen at creation time, not a stable identifier.
    /// `#[serde(default)]` for the same back-compat reasoning as the two
    /// fields above.
    #[serde(default)]
    pub preset_key: Option<String>,
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
pub struct RecurringExpenseRecord {
    pub id: String,
    pub description: String,
    pub category_id: String,
    pub amount: String,
    pub cadence: String,
    pub anchor_date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CategorizationRuleRecord {
    pub id: String,
    pub keyword: String,
    pub category_id: String,
    pub priority: i32,
}
