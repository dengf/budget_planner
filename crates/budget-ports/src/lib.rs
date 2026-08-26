//! Hexagonal *port* definitions for local persistence: the record types
//! and the [`BudgetStore`] trait, with no concrete backend. Adapters
//! (e.g. `budget-ext-redb`) depend *down* on this crate, and callers
//! (`budget-wasm`) depend on the trait, never on a specific backend.

mod error;
mod records;
mod store;

pub use error::StoreError;
pub use records::{
    BudgetPlanRecord, CategorizationRuleRecord, CategoryRecord, DebtRecord, GoalRecord,
    RecurringExpenseRecord, TransactionRecord,
};
pub use store::BudgetStore;
