//! `spend_by_category`, `income_by_category`, and the amount/category
//! helpers the entry form and the uncategorized filter need.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, f64_to_decimal, to_js};
use crate::dto::{
    AmountResultDto, DailySpendResult, DateAmountDto, SignedAmountParams, SignedAmountResult,
    SpendByCategoryParams, SpendByCategoryResult, SplitAmountResult, TransactionDto,
    UncategorizedParams, UncategorizedResult, WeeklySpendParams,
};
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

/// Total spend per day, for the within-month timeseries chart -- see
/// `budget_calc::daily_spend`.
#[wasm_bindgen]
pub fn daily_spend(params: JsValue) -> JsValue {
    to_js(&match parse_transactions(params) {
        Ok(transactions) => DailySpendResult {
            totals: budget_calc::daily_spend(&transactions)
                .into_iter()
                .map(|(date, amount)| DateAmountDto {
                    date,
                    amount: decimal_to_f64(amount),
                })
                .collect(),
            error: None,
        },
        Err(message) => DailySpendResult {
            error: Some(message.text),
            ..Default::default()
        },
    })
}

/// Total spend per ISO week within `month`, for the same chart's
/// Daily/Weekly toggle -- see `budget_calc::weekly_spend`. Shares
/// `DailySpendResult`'s shape with `daily_spend` above (a date-keyed
/// total list plus an error) rather than a dedicated result type, the
/// same way `spend_by_category` and `income_by_category` already share
/// `SpendByCategoryResult`.
#[wasm_bindgen]
pub fn weekly_spend(params: JsValue) -> JsValue {
    to_js(&match parse_weekly_params(params) {
        Ok((transactions, month)) => DailySpendResult {
            totals: budget_calc::weekly_spend(&transactions, &month)
                .into_iter()
                .map(|(date, amount)| DateAmountDto {
                    date,
                    amount: decimal_to_f64(amount),
                })
                .collect(),
            error: None,
        },
        Err(message) => DailySpendResult {
            error: Some(message.text),
            ..Default::default()
        },
    })
}

fn parse_weekly_params(
    params: JsValue,
) -> Result<(Vec<budget_calc::Transaction>, String), Message> {
    let params: WeeklySpendParams =
        serde_wasm_bindgen::from_value(params).map_err(|_| Message::bad_request())?;
    let transactions = params
        .transactions
        .iter()
        .map(from_dto)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(Message::bad_request)?;
    Ok((transactions, params.month))
}

/// A stored amount split into the magnitude and direction the entry form
/// collects -- see `budget_calc::split_amount` for why its inverse
/// (`signed_amount` below) lives beside it.
#[wasm_bindgen]
pub fn split_amount(amount: f64) -> JsValue {
    to_js(&match f64_to_decimal(amount) {
        Some(amount) => {
            let (magnitude, is_income) = budget_calc::split_amount(amount);
            SplitAmountResult {
                magnitude: decimal_to_f64(magnitude),
                is_income,
                error: None,
            }
        }
        None => SplitAmountResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        },
    })
}

/// A magnitude plus a direction composed back into a stored amount. See
/// `budget_calc::signed_amount`.
#[wasm_bindgen]
pub fn signed_amount(params: JsValue) -> JsValue {
    to_js(&match parse_signed_params(params) {
        Ok((magnitude, is_income)) => SignedAmountResult {
            amount: decimal_to_f64(budget_calc::signed_amount(magnitude, is_income)),
            error: None,
        },
        Err(message) => SignedAmountResult {
            error: Some(message.text),
            ..Default::default()
        },
    })
}

fn parse_signed_params(params: JsValue) -> Result<(rust_decimal::Decimal, bool), Message> {
    let params: SignedAmountParams =
        serde_wasm_bindgen::from_value(params).map_err(|_| Message::bad_request())?;
    let magnitude = f64_to_decimal(params.magnitude).ok_or_else(Message::bad_request)?;
    Ok((magnitude, params.is_income))
}

/// Which transactions still need a category, and how many -- see
/// `budget_calc::is_uncategorized`. Both come back from one call so the
/// "Uncategorized (N)" badge and the list it filters to can never
/// disagree.
#[wasm_bindgen]
pub fn uncategorized(params: JsValue) -> JsValue {
    to_js(&match parse_uncategorized_params(params) {
        Ok((transactions, known)) => {
            let ids: Vec<String> = transactions
                .iter()
                .filter(|t| budget_calc::is_uncategorized(t, &known))
                .map(|t| t.id.clone())
                .collect();
            UncategorizedResult {
                count: budget_calc::uncategorized_count(&transactions, &known),
                ids,
                error: None,
            }
        }
        Err(message) => UncategorizedResult {
            error: Some(message.text),
            ..Default::default()
        },
    })
}

fn parse_uncategorized_params(
    params: JsValue,
) -> Result<(Vec<budget_calc::Transaction>, Vec<String>), Message> {
    let params: UncategorizedParams =
        serde_wasm_bindgen::from_value(params).map_err(|_| Message::bad_request())?;
    let transactions = params
        .transactions
        .iter()
        .map(from_dto)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(Message::bad_request)?;
    Ok((transactions, params.existing_category_ids))
}
