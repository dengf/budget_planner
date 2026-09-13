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

    #[error("a recurring expense's amount must be positive, got {0}")]
    InvalidRecurringAmount(String),

    #[error("the PDF has no bytes to read")]
    EmptyPdf,

    #[error("could not read this PDF: {0}")]
    UnreadablePdf(String),

    #[error("the image has no bytes to read")]
    EmptyImage,

    #[error("could not load the OCR model: {0}")]
    OcrModelLoadFailed(String),

    #[error("could not read text from this image: {0}")]
    OcrFailed(String),

    #[error("could not load the classification model: {0}")]
    EmbedModelLoadFailed(String),

    #[error("could not load the classification tokenizer: {0}")]
    EmbedTokenizerLoadFailed(String),

    #[error("could not classify a statement row: {0}")]
    EmbedClassifyFailed(String),

    #[error("could not read this PDF page: {0}")]
    PdfPageOutOfRange(String),

    #[error("could not render this PDF page: {0}")]
    PdfRenderFailed(String),

    #[error("the recording has no audio to read")]
    EmptyAudio,

    #[error("could not load the voice model: {0}")]
    VoiceModelLoadFailed(String),

    #[error("could not transcribe this recording: {0}")]
    VoiceTranscribeFailed(String),
}
