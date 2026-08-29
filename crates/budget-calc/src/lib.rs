//! Every calculation and rule for budget-planner. Categories and the
//! zero-based monthly allocation, categorization rules, CSV import, goal
//! contribution math, and debt payoff planning. No I/O, no clock, no
//! randomness -- see each module's own doc comment for what it takes as
//! an explicit parameter instead.

pub mod category;
pub mod csv_import;
mod date_util;
pub mod debt;
pub mod goals;
#[cfg(feature = "ocr")]
pub mod ocr;
#[cfg(feature = "pdf-text")]
pub mod pdf_text;
pub mod presets;
pub mod receipt;
pub mod recurring;
pub mod rules;
pub mod transaction;

pub use category::{
    build_month, build_savings_line, summarize_month, Category, CategoryLine, MonthSummary,
    SAVINGS_CATEGORY_ID,
};
pub use csv_import::{
    detect_columns, import_csv, ColumnMapping, ImportOutcome, ImportedTransaction, SkippedRow,
};
pub use debt::{build_plan, Debt, PayoffMonth, PayoffPlan, Strategy};
pub use goals::{
    milestone_crossed, petals_filled, progress_ratio, required_contribution, Goal, Milestone,
};
#[cfg(feature = "ocr")]
pub use ocr::run_ocr;
#[cfg(feature = "pdf-text")]
pub use pdf_text::extract_pdf_text;
pub use presets::{starter_categories, PresetCategory};
pub use receipt::{parse_receipt_text, ParsedReceipt};
pub use recurring::{
    occurrences_for_month, occurrences_in_month, totals_by_category, Occurrence, RecurringExpense,
};
pub use rules::{apply_rules, CategorizationRule};
pub use transaction::{daily_spend, income_by_category, spend_by_category, weekly_spend, Transaction};
