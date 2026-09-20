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
#[cfg(feature = "pdf-render")]
pub mod pdf_render;
#[cfg(feature = "pdf-text")]
pub mod pdf_text;
pub mod presets;
pub mod receipt;
pub mod recurring;
pub mod rules;
pub mod transaction;

pub use category::{
    build_month, build_savings_line, carry_plan_forward, category_rank, category_shares,
    month_review, month_setup_state, previous_plan_month, resolve_category_name,
    suggest_plan_from_spending, summarize_month, CarriedPlan, Category, CategoryDelta,
    CategoryLine, CategoryShare, Direction, MonthFacts, MonthPosition, MonthReview,
    MonthSetupState, MonthSummary, NamedCategory, NamedPreset, NewCategoryOutcome, PlanBasis,
    PlanEntry, PlanSuggestionState, RankedCategory, SuggestedPlan, SuggestedRow,
    MIN_TRANSACTIONS_FOR_PLAN, SAVINGS_CATEGORY_ID,
};
pub use csv_import::{
    detect_columns, import_csv, ColumnMapping, ImportOutcome, ImportedTransaction, SkippedRow,
};
pub use debt::{
    apply_payment, build_plan, payoff_amount, Debt, PaymentOutcome, PayoffMonth, PayoffPlan,
    Strategy,
};
#[cfg(feature = "embed-classify")]
pub use embed_classify::classify_statement_descriptions;
pub use goals::{
    allocated_in_month, apply_contribution, contributed_in_month, milestone_crossed, petals_filled,
    progress_ratio, required_contribution, savings_allocation_state, unallocated_savings,
    Contribution, Goal, GoalContribution, Milestone, SavingsAllocationState,
};
#[cfg(feature = "ocr")]
pub use ocr::run_ocr;
#[cfg(feature = "pdf-render")]
pub use pdf_render::{pdf_page_count, render_pdf_page, RenderedPage};
#[cfg(feature = "pdf-text")]
pub use pdf_text::extract_pdf_text;
pub use presets::{compact_starter_categories, starter_categories, PresetCategory};
pub use receipt::{
    classify_by_similarity, parse_receipt_text, parse_statement_text, ParsedReceipt, StatementRow,
    EXPENSE_EXAMPLE_PHRASES, INCOME_EXAMPLE_PHRASES,
};
pub use recurring::{
    match_occurrences, occurrences_for_month, occurrences_in_month, payment_for_occurrence,
    totals_by_category, Occurrence, OccurrencePayment, OccurrenceStatus, RecurringExpense,
};
pub use rules::{apply_rules, suggest_rule_keyword, CategorizationRule};
pub use transaction::{
    daily_spend, income_by_category, is_uncategorized, signed_amount, spend_by_category,
    split_amount, uncategorized_count, weekly_spend, Transaction,
};
