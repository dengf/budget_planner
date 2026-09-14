//! `build_month`, `summarize_month`, `category_rank`.

use wasm_bindgen::prelude::*;

use crate::convert::{f64_to_decimal, to_js};
use crate::dto::{
    BuildMonthParams, BuildMonthResult, BuildSavingsLineParams, BuildSavingsLineResult,
    CategoryLineDto, CategoryRankParams, CategoryRankResult, MonthSummaryDto, RankedCategoryDto,
};
use crate::message::Message;

#[wasm_bindgen]
pub fn build_month(params: JsValue) -> JsValue {
    to_js(&build_month_impl(params))
}

fn build_month_impl(params: JsValue) -> BuildMonthResult {
    let params: BuildMonthParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        let message = Message::bad_request();
        return BuildMonthResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
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

    match budget_calc::build_month(&planned, &previous, &spent) {
        Ok(lines) => {
            let summary = budget_calc::summarize_month(&lines, &params.income_category_ids);
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
                    unspent: crate::convert::decimal_to_f64(summary.unspent),
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

#[wasm_bindgen]
pub fn build_savings_line(params: JsValue) -> JsValue {
    to_js(&build_savings_line_impl(params))
}

fn build_savings_line_impl(params: JsValue) -> BuildSavingsLineResult {
    let params: BuildSavingsLineParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        let message = Message::bad_request();
        return BuildSavingsLineResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
    };

    let (Some(planned), Some(income), Some(total_expense_actual)) = (
        f64_to_decimal(params.planned),
        f64_to_decimal(params.income),
        f64_to_decimal(params.total_expense_actual),
    ) else {
        let message = Message::bad_request();
        return BuildSavingsLineResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
    };

    match budget_calc::build_savings_line(planned, income, total_expense_actual) {
        Ok(l) => BuildSavingsLineResult {
            line: Some(CategoryLineDto {
                category_id: l.category_id,
                planned: crate::convert::decimal_to_f64(l.planned),
                rollover: crate::convert::decimal_to_f64(l.rollover),
                spent: crate::convert::decimal_to_f64(l.spent),
                remaining: crate::convert::decimal_to_f64(l.remaining),
            }),
            error: None,
            error_message: None,
        },
        Err(e) => {
            let message = Message::from(&e);
            BuildSavingsLineResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            }
        }
    }
}

/// Which categories to put in front of someone half-way through adding a
/// transaction -- see `budget_calc::category_rank`.
///
/// The whole ranked list comes back, not a top-N: how many chips fit on
/// a 375px row is a layout question, and this crate has no business
/// having an opinion about it.
#[wasm_bindgen]
pub fn category_rank(params: JsValue) -> JsValue {
    to_js(&category_rank_impl(params))
}

fn category_rank_impl(params: JsValue) -> CategoryRankResult {
    let params: CategoryRankParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        return CategoryRankResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let direction = match params.direction.as_str() {
        "income" => budget_calc::Direction::Income,
        "expense" => budget_calc::Direction::Expense,
        _ => {
            return CategoryRankResult {
                error: Some(Message::bad_request().text),
                ..Default::default()
            }
        }
    };

    let categories: Option<Vec<budget_calc::Category>> = params
        .categories
        .iter()
        .map(|c| {
            budget_calc::Category::new(
                c.id.clone(),
                c.name.clone(),
                c.group.clone(),
                c.is_income,
                c.description.clone(),
            )
            .ok()
        })
        .collect();

    let transactions: Option<Vec<budget_calc::Transaction>> = params
        .transactions
        .iter()
        .map(|t| {
            let mut parsed = budget_calc::Transaction::new(
                t.id.clone(),
                t.date.clone(),
                t.description.clone(),
                f64_to_decimal(t.amount)?,
            );
            parsed.category_id = t.category_id.clone();
            Some(parsed)
        })
        .collect();

    let (Some(categories), Some(transactions)) = (categories, transactions) else {
        return CategoryRankResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    CategoryRankResult {
        ranked: budget_calc::category_rank(&categories, &transactions, &params.as_of, direction)
            .into_iter()
            .map(|r| RankedCategoryDto {
                category_id: r.category_id,
                score: crate::convert::decimal_to_f64(r.score),
                uses: r.uses,
            })
            .collect(),
        error: None,
    }
}
