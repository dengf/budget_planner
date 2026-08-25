use thiserror::Error;

/// Every validation failure the budget-calc crate can produce.
///
/// One flat enum rather than one per module, matching mortgage-core's
/// `MortgageError`: every variant crosses the wasm boundary through
/// `budget-wasm`'s `Message` type, which needs one place to match on.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum BudgetError {
    #[error("category name cannot be blank")]
    BlankCategoryName,

    #[error("planned amount cannot be negative, got {0}")]
    NegativePlannedAmount(String),

    #[error("transaction amount must be a finite number, got {0}")]
    InvalidAmount(String),

    #[error("a goal's target amount must be positive, got {0}")]
    InvalidGoalTarget(String),

    #[error("a goal's target date must be after today")]
    GoalTargetInThePast,

    #[error("a debt's balance must be positive, got {0}")]
    InvalidDebtBalance(String),

    #[error("a debt's interest rate must be zero or positive, got {0}")]
    InvalidDebtRate(String),

    #[error("a debt's minimum payment must be positive, got {0}")]
    InvalidMinPayment(String),

    #[error(
        "the minimum payments across all debts ({minimums}) exceed the extra payment budget \
         ({available})"
    )]
    PayoffBudgetTooSmall { minimums: String, available: String },

    #[error("a categorization rule's keyword cannot be blank")]
    BlankRuleKeyword,

    #[error("could not parse row {row}: {reason}")]
    CsvRow { row: usize, reason: String },

    #[error("the CSV has no rows to import")]
    EmptyCsv,

    #[error("column mapping refers to a column that doesn't exist: {0}")]
    ColumnOutOfRange(String),
}
