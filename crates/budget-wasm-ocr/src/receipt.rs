//! `parse_receipt_text`.

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
