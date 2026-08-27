//! Serde-derived input/output types crossing the JS/Rust boundary.
//!
//! Every result DTO carries an `error: Option<String>` and, where
//! validation can fail, an `error_message: Option<Message>` -- wasm-bindgen
//! return values need one concrete shape, so failures are reported in-band
//! and the frontend checks `result.error`. All money crosses as `f64`;
//! `budget-calc` only ever sees `Decimal`.

use serde::{Deserialize, Serialize};

use crate::message::Message;

// ---- categories & budget -----------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryDto {
    pub id: String,
    pub name: String,
    pub group: String,
    #[serde(default)]
    pub is_income: bool,
}

/// A suggested starter category. Carries the i18n key *and* the English
/// fallback for the same reason `Message` does: the UI composes the name
/// it actually stores, in the reader's language.
#[derive(Debug, Clone, Serialize)]
pub struct PresetCategoryDto {
    pub key: String,
    pub name: String,
    pub group_key: String,
    pub group: String,
    pub is_income: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AmountEntryDto {
    pub category_id: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BuildMonthParams {
    pub income: f64,
    pub planned: Vec<AmountEntryDto>,
    #[serde(default)]
    pub previous_remaining: Vec<AmountEntryDto>,
    #[serde(default)]
    pub spent: Vec<AmountEntryDto>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryLineDto {
    pub category_id: String,
    pub planned: f64,
    pub rollover: f64,
    pub spent: f64,
    pub remaining: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonthSummaryDto {
    pub income: f64,
    pub total_planned: f64,
    pub total_spent: f64,
    pub unassigned: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct BuildMonthResult {
    pub lines: Vec<CategoryLineDto>,
    pub summary: Option<MonthSummaryDto>,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BuildSavingsLineParams {
    pub planned: f64,
    pub income: f64,
    pub total_expense_actual: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct BuildSavingsLineResult {
    pub line: Option<CategoryLineDto>,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

// ---- receipt capture (text parsing only -- OCR/PDF extraction bindings
// live in the sibling budget-wasm-ocr/budget-wasm-pdf crates) -----------

#[derive(Debug, Clone, Default, Serialize)]
pub struct ParseReceiptTextResult {
    pub description: Option<String>,
    pub amount: Option<f64>,
    pub date: Option<String>,
    pub is_income: bool,
}

// ---- transactions & rules -----------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionDto {
    pub id: String,
    pub date: String,
    pub description: String,
    pub amount: f64,
    pub category_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleDto {
    pub id: String,
    pub keyword: String,
    pub category_id: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApplyRulesParams {
    pub transactions: Vec<TransactionDto>,
    pub rules: Vec<RuleDto>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ApplyRulesResult {
    pub transactions: Vec<TransactionDto>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpendByCategoryParams {
    pub transactions: Vec<TransactionDto>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SpendByCategoryResult {
    pub totals: Vec<AmountResultDto>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AmountResultDto {
    pub category_id: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DailySpendResult {
    pub totals: Vec<DateAmountDto>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DateAmountDto {
    pub date: String,
    pub amount: f64,
}

// ---- CSV import -----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMappingDto {
    pub date_col: usize,
    pub description_col: usize,
    pub amount_col: usize,
    pub credit_col: Option<usize>,
    pub has_header: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DetectColumnsResult {
    pub mapping: Option<ColumnMappingDto>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportCsvParams {
    pub csv_text: String,
    pub mapping: ColumnMappingDto,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportedTransactionDto {
    pub transaction: TransactionDto,
    pub source_row: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkippedRowDto {
    pub row: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportCsvResult {
    pub imported: Vec<ImportedTransactionDto>,
    pub skipped: Vec<SkippedRowDto>,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

// ---- goals ----------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct GoalProgressParams {
    pub current_amount: f64,
    pub target_amount: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct GoalProgressResult {
    pub ratio: Option<f64>,
    pub petals_filled: Option<u8>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MilestoneParams {
    pub previous_amount: f64,
    pub new_amount: f64,
    pub target_amount: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct MilestoneResult {
    /// `null` when no milestone was newly crossed -- the common case, and
    /// the frontend's cue to show nothing rather than a repeated toast.
    pub milestone: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RequiredContributionParams {
    pub target_amount: f64,
    pub current_amount: f64,
    pub months_remaining: i64,
    pub cadence: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RequiredContributionResult {
    pub amount: Option<f64>,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

// ---- debt payoff ------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct DebtDto {
    pub id: String,
    pub name: String,
    pub balance: f64,
    pub apr_percent: f64,
    pub min_payment: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BuildPlanParams {
    pub debts: Vec<DebtDto>,
    pub extra_payment: f64,
    pub strategy: Option<String>,
    #[serde(default = "default_max_months")]
    pub max_months: u32,
}

fn default_max_months() -> u32 {
    600
}

#[derive(Debug, Clone, Serialize)]
pub struct PayoffMonthDto {
    pub month: u32,
    pub debt_id: String,
    pub interest: f64,
    pub payment: f64,
    pub remaining_balance: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct BuildPlanResult {
    pub order: Vec<String>,
    pub schedule: Vec<PayoffMonthDto>,
    pub months_to_debt_free: Option<u32>,
    pub total_interest: Option<f64>,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

// ---- storage --------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalDto {
    pub id: String,
    pub name: String,
    pub target_amount: f64,
    pub current_amount: f64,
    pub target_date: String,
    pub cadence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebtRecordDto {
    pub id: String,
    pub name: String,
    pub balance: f64,
    pub apr_percent: f64,
    pub min_payment: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetPlanEntryDto {
    pub id: String,
    pub month: String,
    pub category_id: String,
    pub planned: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringExpenseDto {
    pub id: String,
    pub description: String,
    pub category_id: String,
    pub amount: f64,
    pub cadence: String,
    pub anchor_date: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OccurrencesParams {
    pub recurring: Vec<RecurringExpenseDto>,
    pub month: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OccurrenceDto {
    pub recurring_id: String,
    pub category_id: String,
    pub description: String,
    pub amount: f64,
    pub date: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct OccurrencesResult {
    pub occurrences: Vec<OccurrenceDto>,
    pub totals_by_category: Vec<AmountResultDto>,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SaveResult {
    pub id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DeleteResult {
    pub success: bool,
    pub error: Option<String>,
}
