//! `spend_by_category`, `income_by_category`.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, f64_to_decimal, to_js};
use crate::dto::{AmountResultDto, SpendByCategoryParams, SpendByCategoryResult, TransactionDto};
use crate::message::Message;

fn from_dto(dto: &TransactionDto) -> Option<budget_calc::Transaction> {
    let mut t = budget_calc::Transaction::new(
        dto.id.clone(),
        dto.date.clone(),
        dto.description.clone(),
        f64_to_decimal(dto.amount)?,
    );
    t.category_id = dto.category_id.clone();
    Some(t)
}

/// Shared by both bindings below: parse the params, then the
/// transactions inside them -- the two ways this can fail (unparseable
/// `JsValue`, or a transaction whose `f64` amount isn't finite) produce
/// the same `bad_request` either function would report on its own.
fn parse_transactions(params: JsValue) -> Result<Vec<budget_calc::Transaction>, Message> {
    let params: SpendByCategoryParams =
        serde_wasm_bindgen::from_value(params).map_err(|_| Message::bad_request())?;
    params
        .transactions
        .iter()
        .map(from_dto)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(Message::bad_request)
}

fn totals_result(totals: Vec<(String, rust_decimal::Decimal)>) -> SpendByCategoryResult {
    SpendByCategoryResult {
        totals: totals
            .into_iter()
            .map(|(category_id, amount)| AmountResultDto {
                category_id,
                amount: decimal_to_f64(amount),
            })
            .collect(),
        error: None,
    }
}

#[wasm_bindgen]
pub fn spend_by_category(params: JsValue) -> JsValue {
    to_js(&match parse_transactions(params) {
        Ok(transactions) => totals_result(budget_calc::spend_by_category(&transactions)),
        Err(message) => SpendByCategoryResult {
            error: Some(message.text),
            ..Default::default()
        },
    })
}

/// The positive-side counterpart to `spend_by_category`, for
/// `Category.is_income` categories -- see `budget_calc::income_by_category`.
#[wasm_bindgen]
pub fn income_by_category(params: JsValue) -> JsValue {
    to_js(&match parse_transactions(params) {
        Ok(transactions) => totals_result(budget_calc::income_by_category(&transactions)),
        Err(message) => SpendByCategoryResult {
            error: Some(message.text),
            ..Default::default()
        },
    })
}
