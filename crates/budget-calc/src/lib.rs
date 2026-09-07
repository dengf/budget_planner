//! Every calculation and rule for budget-planner. Categories and the
//! zero-based monthly allocation, categorization rules, CSV import, goal
//! contribution math, and debt payoff planning. No I/O, no clock, no
//! randomness -- see each module's own doc comment for what it takes as
//! an explicit parameter instead.

pub mod category;
pub mod csv_import;
mod date_util;
pub mod debt;
#[cfg(feature = "embed-classify")]
pub mod embed_classify;
pub mod goals;
#[cfg(feature = "ocr")]
pub mod ocr;
#[cfg(feature = "pdf-text")]
pub mod pdf_text;
pub mod presets;
pub mod receipt;
pub mod recurring;
pub mod rules;
#[cfg(feature = "smart-parse")]
pub mod smart_parse;
pub mod transaction;

pub use category::{
    build_month, build_savings_line, summarize_month, Category, CategoryLine, MonthSummary,
    SAVINGS_CATEGORY_ID,
};
pub use csv_import::{
    detect_columns, import_csv, ColumnMapping, ImportOutcome, ImportedTransaction, SkippedRow,
};
pub use debt::{build_plan, Debt, PayoffMonth, PayoffPlan, Strategy};
#[cfg(feature = "embed-classify")]
pub use embed_classify::classify_statement_descriptions;
pub use goals::{
    milestone_crossed, petals_filled, progress_ratio, required_contribution, Goal, Milestone,
};
#[cfg(feature = "ocr")]
pub use ocr::run_ocr;
#[cfg(feature = "pdf-text")]
pub use pdf_text::extract_pdf_text;
pub use presets::{starter_categories, PresetCategory};
pub use receipt::{
    classify_by_similarity, parse_receipt_text, parse_statement_text, ParsedReceipt, StatementRow,
    EXPENSE_EXAMPLE_PHRASES, INCOME_EXAMPLE_PHRASES,
};
pub use recurring::{
    occurrences_for_month, occurrences_in_month, totals_by_category, Occurrence, RecurringExpense,
};
pub use rules::{apply_rules, CategorizationRule};
#[cfg(feature = "smart-parse")]
pub use smart_parse::run_smart_parse;
pub use transaction::{
    daily_spend, income_by_category, spend_by_category, weekly_spend, Transaction,
};
