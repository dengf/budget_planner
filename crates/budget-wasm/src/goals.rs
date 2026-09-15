//! `goal_progress`, `milestone_crossed`, `required_contribution`,
//! `goal_contribution`, `unallocated_savings`.

use wasm_bindgen::prelude::*;

use crate::convert::{cadence_name, decimal_to_f64, f64_to_decimal, parse_cadence, to_js};
use crate::dto::{
    GoalContributionDto, GoalContributionParams, GoalContributionResult, GoalDto,
    GoalProgressParams, GoalProgressResult, MilestoneParams, MilestoneResult,
    RequiredContributionParams, RequiredContributionResult, UnallocatedSavingsParams,
    UnallocatedSavingsResult,
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
        ratio: Some(decimal_to_f64(budget_calc::progress_ratio(current, target))),
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

    let milestone = budget_calc::milestone_crossed(previous, new_amount, target)
        .map(|m| milestone_name(m).to_string());

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
    let params: RequiredContributionParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        let message = Message::bad_request();
        return RequiredContributionResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
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
        amount: Some(decimal_to_f64(amount)),
        error: None,
        error_message: None,
    }
}

fn milestone_name(m: budget_calc::Milestone) -> &'static str {
    match m {
        budget_calc::Milestone::GoalReached => "goal_reached",
        budget_calc::Milestone::ThreeQuarters => "three_quarters",
        budget_calc::Milestone::Halfway => "halfway",
        budget_calc::Milestone::FirstQuarter => "first_quarter",
    }
}

/// A `GoalDto` as `budget-calc` sees it, ledger included.
///
/// Built field by field rather than through `Goal::new` because that
/// constructor is for a *new* goal -- it zeroes `current_amount` and
/// starts an empty ledger, which is exactly wrong for a goal being read
/// back to have a contribution applied to it. The one check `new` makes
/// that still matters here (a target that isn't a positive amount) is
/// made explicitly below.
fn goal_from_dto(dto: &GoalDto) -> Option<Result<budget_calc::Goal, budget_core::BudgetError>> {
    let target_amount = f64_to_decimal(dto.target_amount)?;
    let current_amount = f64_to_decimal(dto.current_amount)?;
    if target_amount.is_sign_negative() || target_amount.is_zero() {
        return Some(Err(budget_core::BudgetError::InvalidGoalTarget(
            target_amount.to_string(),
        )));
    }
    let mut contributions = Vec::with_capacity(dto.contributions.len());
    for c in &dto.contributions {
        contributions.push(budget_calc::Contribution {
            month: c.month.clone(),
            amount: f64_to_decimal(c.amount)?,
        });
    }
    Some(Ok(budget_calc::Goal {
        id: dto.id.clone(),
        name: dto.name.clone(),
        target_amount,
        current_amount,
        target_date: dto.target_date.clone(),
        cadence: parse_cadence(Some(dto.cadence.as_str())),
        contributions,
    }))
}

fn goal_to_dto(goal: &budget_calc::Goal) -> GoalDto {
    GoalDto {
        id: goal.id.clone(),
        name: goal.name.clone(),
        target_amount: decimal_to_f64(goal.target_amount),
        current_amount: decimal_to_f64(goal.current_amount),
        target_date: goal.target_date.clone(),
        cadence: cadence_name(goal.cadence).to_string(),
        contributions: goal
            .contributions
            .iter()
            .map(|c| GoalContributionDto {
                month: c.month.clone(),
                amount: decimal_to_f64(c.amount),
            })
            .collect(),
    }
}

/// Move a month's savings into a goal -- see
/// `budget_calc::apply_contribution`, including why this deliberately
/// creates no transaction.
///
/// Returns the whole updated goal, ledger and balance together, because
/// those two are only ever correct when written in the same save.
#[wasm_bindgen]
pub fn goal_contribution(params: JsValue) -> JsValue {
    to_js(&goal_contribution_impl(params))
}

fn goal_contribution_impl(params: JsValue) -> GoalContributionResult {
    fn failed(message: Message) -> GoalContributionResult {
        GoalContributionResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        }
    }
    let Ok(params) = serde_wasm_bindgen::from_value::<GoalContributionParams>(params) else {
        return failed(Message::bad_request());
    };
    let goal = match goal_from_dto(&params.goal) {
        Some(Ok(goal)) => goal,
        Some(Err(e)) => return failed(Message::from(&e)),
        None => return failed(Message::bad_request()),
    };
    let Some(amount) = f64_to_decimal(params.amount) else {
        return failed(Message::bad_request());
    };

    match budget_calc::apply_contribution(&goal, &params.month, amount) {
        Ok(out) => GoalContributionResult {
            goal: Some(goal_to_dto(&out.goal)),
            milestone: out.milestone.map(|m| milestone_name(m).to_string()),
            error: None,
            error_message: None,
        },
        Err(e) => failed(Message::from(&e)),
    }
}

/// How much of a month's savings is still unclaimed by any goal -- see
/// `budget_calc::unallocated_savings`.
#[wasm_bindgen]
pub fn unallocated_savings(params: JsValue) -> JsValue {
    to_js(&unallocated_savings_impl(params))
}

fn unallocated_savings_impl(params: JsValue) -> UnallocatedSavingsResult {
    fn failed(message: Message) -> UnallocatedSavingsResult {
        UnallocatedSavingsResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        }
    }
    let Ok(params) = serde_wasm_bindgen::from_value::<UnallocatedSavingsParams>(params) else {
        return failed(Message::bad_request());
    };
    let Some(savings_actual) = f64_to_decimal(params.savings_actual) else {
        return failed(Message::bad_request());
    };
    let mut goals = Vec::with_capacity(params.goals.len());
    for dto in &params.goals {
        match goal_from_dto(dto) {
            Some(Ok(goal)) => goals.push(goal),
            Some(Err(e)) => return failed(Message::from(&e)),
            None => return failed(Message::bad_request()),
        }
    }

    let state = match budget_calc::savings_allocation_state(savings_actual, &goals, &params.month) {
        budget_calc::SavingsAllocationState::NothingSaved => "nothing_saved",
        budget_calc::SavingsAllocationState::Unallocated => "unallocated",
        budget_calc::SavingsAllocationState::FullyAllocated => "fully_allocated",
        budget_calc::SavingsAllocationState::OverAllocated => "over_allocated",
    };

    UnallocatedSavingsResult {
        state: state.to_string(),
        amount: decimal_to_f64(budget_calc::unallocated_savings(
            savings_actual,
            &goals,
            &params.month,
        )),
        allocated: decimal_to_f64(budget_calc::allocated_in_month(&goals, &params.month)),
        error: None,
        error_message: None,
    }
}
