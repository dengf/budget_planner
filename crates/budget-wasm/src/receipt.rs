//! `parse_receipt_text`.
//!
//! Lives here, not in either lazily-loaded receipt-capture crate: the
//! amount/date/description heuristics in `budget_calc::receipt` are plain
//! string and `Decimal` parsing -- no `ocrs-cjk`/`rten`/`pdf-extract`, so
//! nothing about this binding needs the split. Putting it in the
//! always-loaded core module instead means the OCR and PDF crates each
//! call it via the main-thread `wasmModule` after their own worker call
//! returns text, rather than needing their own copy of this binding (and
//! it never blocks on a lazy `import()` neither of them may have
//! triggered yet).

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, to_js};
use crate::dto::{ParseReceiptTextResult, ParseStatementTextResult, StatementRowDto};

#[wasm_bindgen]
pub fn parse_receipt_text(text: &str) -> JsValue {
    let parsed = budget_calc::parse_receipt_text(text);
    to_js(&ParseReceiptTextResult {
        description: parsed.description,
        amount: parsed.amount.map(decimal_to_f64),
        date: parsed.date,
        is_income: parsed.is_income,
    })
}

/// Multi-row counterpart to `parse_receipt_text`, for a bank/card
/// statement PDF instead of a single receipt -- see
/// `budget_calc::parse_statement_text`'s doc comment for why it's a
/// separate function rather than a mode of the single-row one.
#[wasm_bindgen]
pub fn parse_statement_text(text: &str) -> JsValue {
    let rows = budget_calc::parse_statement_text(text)
        .into_iter()
        .map(|r| StatementRowDto {
            line: r.line,
            date: r.date,
            description: r.description,
            amount: decimal_to_f64(r.amount),
            is_income: r.is_income,
            direction_is_guessed: r.direction_is_guessed,
        })
        .collect();
    to_js(&ParseStatementTextResult { rows })
}
