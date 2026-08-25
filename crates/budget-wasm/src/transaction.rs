//! `spend_by_category`.

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

#[wasm_bindgen]
pub fn spend_by_category(params: JsValue) -> JsValue {
    to_js(&spend_by_category_impl(params))
}

fn spend_by_category_impl(params: JsValue) -> SpendByCategoryResult {
    let params: SpendByCategoryParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            let message = Message::bad_request();
            return SpendByCategoryResult {
                error: Some(message.text),
                ..Default::default()
            };
        }
    };

    let Some(transactions): Option<Vec<_>> = params.transactions.iter().map(from_dto).collect()
    else {
        let message = Message::bad_request();
        return SpendByCategoryResult {
            error: Some(message.text),
            ..Default::default()
        };
    };

    let totals = budget_calc::spend_by_category(&transactions)
        .into_iter()
        .map(|(category_id, amount)| AmountResultDto {
            category_id,
            amount: decimal_to_f64(amount),
        })
        .collect();

    SpendByCategoryResult {
        totals,
        error: None,
    }
}
