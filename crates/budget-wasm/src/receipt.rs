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
use crate::dto::ParseReceiptTextResult;

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
