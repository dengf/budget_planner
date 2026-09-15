//! `build_payoff_plan`, `record_debt_payment`, `debt_payoff_amount`.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, f64_to_decimal, parse_strategy, percent_to_rate, to_js};
use crate::dto::{
    BuildPlanParams, BuildPlanResult, DebtDto, DebtPaymentParams, DebtPaymentResult,
    PayoffAmountParams, PayoffAmountResult, PayoffMonthDto,
};
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
    let params: BuildPlanParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        let message = Message::bad_request();
        return BuildPlanResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
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

/// What a payment does to a debt this month -- see
/// `budget_calc::apply_payment`. The caller stores `new_balance` and
/// logs the transaction; the arithmetic that says what the payment
/// actually achieved happens here, through the same `step` the payoff
/// projection uses.
#[wasm_bindgen]
pub fn record_debt_payment(params: JsValue) -> JsValue {
    to_js(&record_debt_payment_impl(params))
}

fn record_debt_payment_impl(params: JsValue) -> DebtPaymentResult {
    fn failed(message: Message) -> DebtPaymentResult {
        DebtPaymentResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        }
    }
    let Ok(params) = serde_wasm_bindgen::from_value::<DebtPaymentParams>(params) else {
        return failed(Message::bad_request());
    };
    let debt = match debt_from_dto(&params.debt) {
        Some(Ok(debt)) => debt,
        Some(Err(e)) => return failed(Message::from(&e)),
        None => return failed(Message::bad_request()),
    };
    let Some(payment) = f64_to_decimal(params.payment) else {
        return failed(Message::bad_request());
    };

    match budget_calc::apply_payment(&debt, payment) {
        Ok(out) => DebtPaymentResult {
            interest: decimal_to_f64(out.interest),
            principal: decimal_to_f64(out.principal),
            new_balance: decimal_to_f64(out.new_balance),
            paid_off: out.paid_off,
            covers_interest: out.covers_interest,
            overpaid: decimal_to_f64(out.overpaid),
            error: None,
            error_message: None,
        },
        Err(e) => failed(Message::from(&e)),
    }
}

/// What it would take to close this debt today -- see
/// `budget_calc::payoff_amount`.
#[wasm_bindgen]
pub fn debt_payoff_amount(params: JsValue) -> JsValue {
    to_js(&debt_payoff_amount_impl(params))
}

fn debt_payoff_amount_impl(params: JsValue) -> PayoffAmountResult {
    fn failed(message: Message) -> PayoffAmountResult {
        PayoffAmountResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        }
    }
    let Ok(params) = serde_wasm_bindgen::from_value::<PayoffAmountParams>(params) else {
        return failed(Message::bad_request());
    };
    match debt_from_dto(&params.debt) {
        Some(Ok(debt)) => PayoffAmountResult {
            amount: decimal_to_f64(budget_calc::payoff_amount(&debt)),
            error: None,
            error_message: None,
        },
        Some(Err(e)) => failed(Message::from(&e)),
        None => failed(Message::bad_request()),
    }
}
