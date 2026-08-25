//! `goal_progress`, `milestone_crossed`, `required_contribution`.

use wasm_bindgen::prelude::*;

use crate::convert::{f64_to_decimal, parse_cadence, to_js};
use crate::dto::{
    GoalProgressParams, GoalProgressResult, MilestoneParams, MilestoneResult,
    RequiredContributionParams, RequiredContributionResult,
};
use crate::message::Message;

#[wasm_bindgen]
pub fn goal_progress(params: JsValue) -> JsValue {
    to_js(&goal_progress_impl(params))
}

fn goal_progress_impl(params: JsValue) -> GoalProgressResult {
    let params: GoalProgressParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            return GoalProgressResult {
                error: Some(Message::bad_request().text),
                ..Default::default()
            }
        }
    };
    let (Some(current), Some(target)) = (
        f64_to_decimal(params.current_amount),
        f64_to_decimal(params.target_amount),
    ) else {
        return GoalProgressResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    GoalProgressResult {
        ratio: Some(crate::convert::decimal_to_f64(budget_calc::progress_ratio(
            current, target,
        ))),
        petals_filled: Some(budget_calc::petals_filled(current, target)),
        error: None,
    }
}

#[wasm_bindgen]
pub fn milestone_crossed(params: JsValue) -> JsValue {
    to_js(&milestone_crossed_impl(params))
}

fn milestone_crossed_impl(params: JsValue) -> MilestoneResult {
    let params: MilestoneParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            return MilestoneResult {
                error: Some(Message::bad_request().text),
                ..Default::default()
            }
        }
    };
    let (Some(previous), Some(new_amount), Some(target)) = (
        f64_to_decimal(params.previous_amount),
        f64_to_decimal(params.new_amount),
        f64_to_decimal(params.target_amount),
    ) else {
        return MilestoneResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let milestone = budget_calc::milestone_crossed(previous, new_amount, target).map(|m| {
        match m {
            budget_calc::Milestone::GoalReached => "goal_reached",
            budget_calc::Milestone::ThreeQuarters => "three_quarters",
            budget_calc::Milestone::Halfway => "halfway",
            budget_calc::Milestone::FirstQuarter => "first_quarter",
        }
        .to_string()
    });

    MilestoneResult {
        milestone,
        error: None,
    }
}

#[wasm_bindgen]
pub fn required_contribution(params: JsValue) -> JsValue {
    to_js(&required_contribution_impl(params))
}

fn required_contribution_impl(params: JsValue) -> RequiredContributionResult {
    let params: RequiredContributionParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            let message = Message::bad_request();
            return RequiredContributionResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            };
        }
    };
    let (Some(target), Some(current)) = (
        f64_to_decimal(params.target_amount),
        f64_to_decimal(params.current_amount),
    ) else {
        let message = Message::bad_request();
        return RequiredContributionResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
    };

    let amount = budget_calc::required_contribution(
        target,
        current,
        params.months_remaining,
        parse_cadence(params.cadence.as_deref()),
    );

    RequiredContributionResult {
        amount: Some(crate::convert::decimal_to_f64(amount)),
        error: None,
        error_message: None,
    }
}
