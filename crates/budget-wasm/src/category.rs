//! `build_month`, `summarize_month`.

use wasm_bindgen::prelude::*;

use crate::convert::{f64_to_decimal, to_js};
use crate::dto::{BuildMonthParams, BuildMonthResult, CategoryLineDto, MonthSummaryDto};
use crate::message::Message;

#[wasm_bindgen]
pub fn build_month(params: JsValue) -> JsValue {
    to_js(&build_month_impl(params))
}

fn build_month_impl(params: JsValue) -> BuildMonthResult {
    let params: BuildMonthParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            let message = Message::bad_request();
            return BuildMonthResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            };
        }
    };

    let to_pairs =
        |entries: &[crate::dto::AmountEntryDto]| -> Option<Vec<(String, rust_decimal::Decimal)>> {
            entries
                .iter()
                .map(|e| Some((e.category_id.clone(), f64_to_decimal(e.amount)?)))
                .collect()
        };

    let (Some(planned), Some(previous), Some(spent)) = (
        to_pairs(&params.planned),
        to_pairs(&params.previous_remaining),
        to_pairs(&params.spent),
    ) else {
        let message = Message::bad_request();
        return BuildMonthResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
    };
    let Some(income) = f64_to_decimal(params.income) else {
        let message = Message::bad_request();
        return BuildMonthResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
    };

    match budget_calc::build_month(&planned, &previous, &spent) {
        Ok(lines) => {
            let summary = budget_calc::summarize_month(income, &lines);
            BuildMonthResult {
                lines: lines
                    .into_iter()
                    .map(|l| CategoryLineDto {
                        category_id: l.category_id,
                        planned: crate::convert::decimal_to_f64(l.planned),
                        rollover: crate::convert::decimal_to_f64(l.rollover),
                        spent: crate::convert::decimal_to_f64(l.spent),
                        remaining: crate::convert::decimal_to_f64(l.remaining),
                    })
                    .collect(),
                summary: Some(MonthSummaryDto {
                    income: crate::convert::decimal_to_f64(summary.income),
                    total_planned: crate::convert::decimal_to_f64(summary.total_planned),
                    total_spent: crate::convert::decimal_to_f64(summary.total_spent),
                    unassigned: crate::convert::decimal_to_f64(summary.unassigned),
                }),
                error: None,
                error_message: None,
            }
        }
        Err(e) => {
            let message = Message::from(&e);
            BuildMonthResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            }
        }
    }
}
