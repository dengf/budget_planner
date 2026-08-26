//! Every calculation and rule for budget-planner. Categories and the
//! zero-based monthly allocation, categorization rules, CSV import, goal
//! contribution math, and debt payoff planning. No I/O, no clock, no
//! randomness -- see each module's own doc comment for what it takes as
//! an explicit parameter instead.

pub mod category;
pub mod csv_import;
pub mod debt;
pub mod goals;
pub mod presets;
pub mod rules;
pub mod transaction;

pub use category::{build_month, summarize_month, Category, CategoryLine, MonthSummary};
pub use csv_import::{import_csv, ColumnMapping, ImportOutcome, ImportedTransaction, SkippedRow};
pub use debt::{build_plan, Debt, PayoffMonth, PayoffPlan, Strategy};
pub use goals::{
    milestone_crossed, petals_filled, progress_ratio, required_contribution, Goal, Milestone,
};
pub use presets::{for_region, PresetCategory};
pub use rules::{apply_rules, CategorizationRule};
pub use transaction::{spend_by_category, Transaction};
