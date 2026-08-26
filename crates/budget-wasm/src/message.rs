//! Stable message codes for text the UI has to show a user. Same
//! convention as mortgage-wasm's `Message`: an error crosses the wasm
//! boundary as a code plus its parameters, and the UI composes the
//! sentence in whichever language it's running, with the English text
//! carried alongside as a fallback.

use std::collections::BTreeMap;

use budget_core::BudgetError;
use serde::Serialize;

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
        ];
        let codes: std::collections::BTreeSet<_> =
            all.iter().map(|e| Message::from(e).code).collect();
        assert_eq!(codes.len(), all.len());
        assert!(codes.iter().all(|c| c.starts_with("err.")));
    }
}

/// Guards the boundary against leaking a foreign error's `Debug` output to
/// the page. Ported verbatim from mortgage-wasm's `message.rs`; see that
/// module for the full rationale (a `serde_wasm_bindgen::Error`'s `Debug`
/// rendering is a live JS stack trace).
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[
        ("category.rs", include_str!("category.rs")),
        ("transaction.rs", include_str!("transaction.rs")),
        ("rules.rs", include_str!("rules.rs")),
        ("csv_import.rs", include_str!("csv_import.rs")),
        ("goals.rs", include_str!("goals.rs")),
        ("debt.rs", include_str!("debt.rs")),
        ("presets.rs", include_str!("presets.rs")),
        // include_str! reads the file regardless of the target the crate is
        // compiled for -- only the `pub mod storage;` declaration in lib.rs
        // is cfg-gated to wasm32, so this line is safe to keep unconditional.
        ("storage.rs", include_str!("storage.rs")),
    ];

    #[test]
    fn every_binding_serializes_through_the_json_compatible_helper() {
        let mut offenders = Vec::new();
        for (name, source) in BINDINGS {
            for (i, line) in source.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                if code.contains("serde_wasm_bindgen::to_value") {
                    offenders.push(format!("{name}:{}", i + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these lines serialize with serde_wasm_bindgen::to_value: {offenders:?}. \
             Use convert::to_js."
        );
    }

    #[test]
    fn no_binding_debug_formats_an_error_into_a_user_facing_field() {
        let mut offenders = Vec::new();
        for (name, source) in BINDINGS {
            for (i, line) in source.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                if code.contains("{e:?}") || code.contains("{err:?}") {
                    offenders.push(format!("{name}:{}", i + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these lines Debug-format an error that reaches the DOM: {offenders:?}. \
             Use Message::bad_request() instead."
        );
    }

    #[test]
    fn the_bad_request_message_names_no_internals() {
        let text = super::Message::bad_request().text;
        for leak in ["wasm", "Error(", "JsValue", "f64", ".js:", "0x"] {
            assert!(
                !text.contains(leak),
                "bad_request text leaks {leak:?}: {text}"
            );
        }
    }
}
