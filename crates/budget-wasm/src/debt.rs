//! `build_payoff_plan`.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, f64_to_decimal, parse_strategy, percent_to_rate, to_js};
use crate::dto::{BuildPlanParams, BuildPlanResult, DebtDto, PayoffMonthDto};
use crate::message::Message;

fn debt_from_dto(dto: &DebtDto) -> Option<Result<budget_calc::Debt, budget_core::BudgetError>> {
    let balance = f64_to_decimal(dto.balance)?;
    let apr = percent_to_rate(dto.apr_percent)?;
    let min_payment = f64_to_decimal(dto.min_payment)?;
    Some(budget_calc::Debt::new(
        dto.id.clone(),
        dto.name.clone(),
        balance,
        apr,
        min_payment,
    ))
}

#[wasm_bindgen]
pub fn build_payoff_plan(params: JsValue) -> JsValue {
    to_js(&build_payoff_plan_impl(params))
}

fn build_payoff_plan_impl(params: JsValue) -> BuildPlanResult {
    let params: BuildPlanParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            let message = Message::bad_request();
            return BuildPlanResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            };
        }
    };

    let mut debts = Vec::with_capacity(params.debts.len());
    for dto in &params.debts {
        match debt_from_dto(dto) {
            Some(Ok(d)) => debts.push(d),
            Some(Err(e)) => {
                let message = Message::from(&e);
                return BuildPlanResult {
                    error: Some(message.text.clone()),
                    error_message: Some(message),
                    ..Default::default()
                };
            }
            None => {
                let message = Message::bad_request();
                return BuildPlanResult {
                    error: Some(message.text.clone()),
                    error_message: Some(message),
                    ..Default::default()
                };
            }
        }
    }

    let Some(extra_payment) = f64_to_decimal(params.extra_payment) else {
        let message = Message::bad_request();
        return BuildPlanResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
    };

    let strategy = parse_strategy(params.strategy.as_deref());

    match budget_calc::build_plan(&debts, extra_payment, strategy, params.max_months) {
        Ok(plan) => BuildPlanResult {
            order: plan.order,
            schedule: plan
                .schedule
                .into_iter()
                .map(|m| PayoffMonthDto {
                    month: m.month,
                    debt_id: m.debt_id,
                    interest: decimal_to_f64(m.interest),
                    payment: decimal_to_f64(m.payment),
                    remaining_balance: decimal_to_f64(m.remaining_balance),
                })
                .collect(),
            months_to_debt_free: Some(plan.months_to_debt_free),
            total_interest: Some(decimal_to_f64(plan.total_interest)),
            error: None,
            error_message: None,
        },
        Err(e) => {
            let message = Message::from(&e);
            BuildPlanResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            }
        }
    }
}
