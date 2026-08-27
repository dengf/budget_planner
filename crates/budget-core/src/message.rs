//! Stable message codes for text the UI has to show a user. An error
//! crosses the wasm boundary as a code plus its parameters, and the UI
//! composes the sentence in whichever language it's running, with the
//! English text carried alongside as a fallback.
//!
//! Lives in `budget-core`, not `budget-wasm`, because two wasm-bindgen
//! crates now map `BudgetError` to this same shape --
//! `budget-wasm` and the lazily-loaded `budget-wasm-ocr` (split out to
//! keep the OCR engine's several-megabyte payload out of the wasm every
//! visit downloads; see that crate's own doc comment). Duplicating this
//! mapping between them would be exactly the kind of drift CLAUDE.md
//! warns about -- a new `BudgetError` variant updated in one copy and
//! forgotten in the other shows up as a silently blank error message in
//! whichever binding was missed, not a build failure.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::BudgetError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Message {
    pub code: String,
    pub params: BTreeMap<String, String>,
    pub text: String,
}

impl Message {
    fn new(code: &str, params: BTreeMap<String, String>, text: String) -> Self {
        Self {
            code: code.to_string(),
            params,
            text,
        }
    }

    pub fn bare(code: &str, text: impl Into<String>) -> Self {
        Self::new(code, BTreeMap::new(), text.into())
    }

    pub fn with_value(code: &str, value: impl Into<String>, text: String) -> Self {
        let mut params = BTreeMap::new();
        params.insert("value".to_string(), value.into());
        Self::new(code, params, text)
    }

    pub fn with_params(
        code: &str,
        params: impl IntoIterator<Item = (String, String)>,
        text: String,
    ) -> Self {
        Self::new(code, params.into_iter().collect(), text)
    }

    /// The values a caller sent could not be read into the expected shape.
    /// Carries nothing from the underlying `serde_wasm_bindgen::Error` --
    /// see mortgage-wasm's `Message::bad_request` for why: that error
    /// wraps a live JS stack trace, and every caller writes this straight
    /// into the DOM.
    pub fn bad_request() -> Self {
        Message::bare(
            "err.badRequest",
            "Some values are missing or aren't valid. Check the fields above.",
        )
    }
}

impl From<&BudgetError> for Message {
    fn from(error: &BudgetError) -> Self {
        let text = error.to_string();
        match error {
            BudgetError::BlankCategoryName => Message::bare("err.blankCategoryName", text),
            BudgetError::NegativePlannedAmount(v) => {
                Message::with_value("err.negativePlanned", v.clone(), text)
            }
            BudgetError::InvalidAmount(v) => {
                Message::with_value("err.invalidAmount", v.clone(), text)
            }
            BudgetError::InvalidGoalTarget(v) => {
                Message::with_value("err.invalidGoalTarget", v.clone(), text)
            }
            BudgetError::GoalTargetInThePast => Message::bare("err.goalTargetInThePast", text),
            BudgetError::InvalidDebtBalance(v) => {
                Message::with_value("err.invalidDebtBalance", v.clone(), text)
            }
            BudgetError::InvalidDebtRate(v) => {
                Message::with_value("err.invalidDebtRate", v.clone(), text)
            }
            BudgetError::InvalidMinPayment(v) => {
                Message::with_value("err.invalidMinPayment", v.clone(), text)
            }
            BudgetError::InvalidRecurringAmount(v) => {
                Message::with_value("err.invalidRecurringAmount", v.clone(), text)
            }
            BudgetError::PayoffBudgetTooSmall {
                minimums,
                available,
            } => {
                let mut params = BTreeMap::new();
                params.insert("minimums".to_string(), minimums.clone());
                params.insert("available".to_string(), available.clone());
                Message::new("err.payoffBudgetTooSmall", params, text)
            }
            BudgetError::BlankRuleKeyword => Message::bare("err.blankRuleKeyword", text),
            BudgetError::CsvRow { row, reason } => {
                let mut params = BTreeMap::new();
                params.insert("row".to_string(), row.to_string());
                params.insert("reason".to_string(), reason.clone());
                Message::new("err.csvRow", params, text)
            }
            BudgetError::EmptyCsv => Message::bare("err.emptyCsv", text),
            BudgetError::ColumnOutOfRange(v) => {
                Message::with_value("err.columnOutOfRange", v.clone(), text)
            }
            BudgetError::EmptyPdf => Message::bare("err.emptyPdf", text),
            BudgetError::UnreadablePdf(v) => {
                Message::with_value("err.unreadablePdf", v.clone(), text)
            }
            BudgetError::EmptyImage => Message::bare("err.emptyImage", text),
            BudgetError::OcrModelLoadFailed(v) => {
                Message::with_value("err.ocrModelLoadFailed", v.clone(), text)
            }
            BudgetError::OcrFailed(v) => Message::with_value("err.ocrFailed", v.clone(), text),
        }
    }
}

impl From<BudgetError> for Message {
    fn from(error: BudgetError) -> Self {
        Message::from(&error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carries_the_offending_value() {
        let msg = Message::from(&BudgetError::InvalidGoalTarget("-5".into()));
        assert_eq!(msg.code, "err.invalidGoalTarget");
        assert_eq!(msg.params.get("value").unwrap(), "-5");
    }

    #[test]
    fn names_both_values_for_a_two_part_error() {
        let msg = Message::from(&BudgetError::PayoffBudgetTooSmall {
            minimums: "500".into(),
            available: "100".into(),
        });
        assert_eq!(msg.params.get("minimums").unwrap(), "500");
        assert_eq!(msg.params.get("available").unwrap(), "100");
    }

    #[test]
    fn every_variant_maps_to_a_distinct_code() {
        let all = [
            BudgetError::BlankCategoryName,
            BudgetError::NegativePlannedAmount("1".into()),
            BudgetError::InvalidAmount("1".into()),
            BudgetError::InvalidGoalTarget("1".into()),
            BudgetError::GoalTargetInThePast,
            BudgetError::InvalidDebtBalance("1".into()),
            BudgetError::InvalidDebtRate("1".into()),
            BudgetError::InvalidMinPayment("1".into()),
            BudgetError::InvalidRecurringAmount("1".into()),
            BudgetError::PayoffBudgetTooSmall {
                minimums: "1".into(),
                available: "1".into(),
            },
            BudgetError::BlankRuleKeyword,
            BudgetError::CsvRow {
                row: 1,
                reason: "x".into(),
            },
            BudgetError::EmptyCsv,
            BudgetError::ColumnOutOfRange("1".into()),
            BudgetError::EmptyPdf,
            BudgetError::UnreadablePdf("1".into()),
            BudgetError::EmptyImage,
            BudgetError::OcrModelLoadFailed("1".into()),
            BudgetError::OcrFailed("1".into()),
        ];
        let codes: std::collections::BTreeSet<_> =
            all.iter().map(|e| Message::from(e).code).collect();
        assert_eq!(codes.len(), all.len());
        assert!(codes.iter().all(|c| c.starts_with("err.")));
    }
}
