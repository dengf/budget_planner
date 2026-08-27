//! Every calculation and rule for budget-planner. Categories and the
//! zero-based monthly allocation, categorization rules, CSV import, goal
//! contribution math, and debt payoff planning. No I/O, no clock, no
//! randomness -- see each module's own doc comment for what it takes as
//! an explicit parameter instead.

pub mod category;
pub mod csv_import;
pub mod debt;
pub mod goals;
pub mod ocr;
pub mod pdf_text;
pub mod presets;
pub mod receipt;
pub mod recurring;
pub mod rules;
pub mod transaction;

pub use category::{build_month, summarize_month, Category, CategoryLine, MonthSummary};
pub use csv_import::{
    detect_columns, import_csv, ColumnMapping, ImportOutcome, ImportedTransaction, SkippedRow,
};
pub use debt::{build_plan, Debt, PayoffMonth, PayoffPlan, Strategy};
pub use goals::{
    milestone_crossed, petals_filled, progress_ratio, required_contribution, Goal, Milestone,
};
pub use ocr::run_ocr;
pub use pdf_text::extract_pdf_text;
pub use presets::{for_region, PresetCategory};
pub use receipt::{parse_receipt_text, ParsedReceipt};
pub use recurring::{
    occurrences_for_month, occurrences_in_month, totals_by_category, Occurrence, RecurringExpense,
};
pub use rules::{apply_rules, CategorizationRule};
pub use transaction::{daily_spend, income_by_category, spend_by_category, Transaction};
