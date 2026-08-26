//! `recurring_occurrences`.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, f64_to_decimal, parse_cadence, to_js};
use crate::dto::{AmountResultDto, OccurrenceDto, OccurrencesParams, OccurrencesResult};
use crate::message::Message;

fn from_dto(dto: &crate::dto::RecurringExpenseDto) -> Option<budget_calc::RecurringExpense> {
    budget_calc::RecurringExpense::new(
        dto.id.clone(),
        dto.description.clone(),
        dto.category_id.clone(),
        f64_to_decimal(dto.amount)?,
        parse_cadence(Some(&dto.cadence)),
        dto.anchor_date.clone(),
    )
    .ok()
}

#[wasm_bindgen]
pub fn recurring_occurrences(params: JsValue) -> JsValue {
    to_js(&recurring_occurrences_impl(params))
}

fn recurring_occurrences_impl(params: JsValue) -> OccurrencesResult {
    let params: OccurrencesParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            let message = Message::bad_request();
            return OccurrencesResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            };
        }
    };

    // A malformed individual record (bad amount, corrupted from storage)
    // is dropped rather than failing the whole month's view -- one
    // damaged recurring expense should not hide every other one's
    // upcoming dates.
    let expenses: Vec<_> = params.recurring.iter().filter_map(from_dto).collect();

    let occurrences = budget_calc::occurrences_for_month(&expenses, &params.month);
    let totals = budget_calc::totals_by_category(&occurrences);

    OccurrencesResult {
        occurrences: occurrences
            .into_iter()
            .map(|o| OccurrenceDto {
                recurring_id: o.recurring_id,
                category_id: o.category_id,
                description: o.description,
                amount: decimal_to_f64(o.amount),
                date: o.date,
            })
            .collect(),
        totals_by_category: totals
            .into_iter()
            .map(|(category_id, amount)| AmountResultDto {
                category_id,
                amount: decimal_to_f64(amount),
            })
            .collect(),
        error: None,
        error_message: None,
    }
}
