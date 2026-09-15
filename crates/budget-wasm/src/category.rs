//! `build_month`, `summarize_month`, `category_rank`, `category_shares`,
//! `month_setup_state`, `carry_plan_forward`, `month_review`,
//! `suggest_plan_from_spending`, `resolve_category_name`.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, f64_to_decimal, to_js};
use crate::dto::{
    BuildMonthParams, BuildMonthResult, BuildSavingsLineParams, BuildSavingsLineResult,
    CarryPlanParams, CarryPlanResult, CategoryDeltaDto, CategoryDto, CategoryLineDto,
    CategoryRankParams, CategoryRankResult, CategoryShareDto, CategorySharesParams,
    CategorySharesResult, MonthReviewParams, MonthReviewResult, MonthSetupStateParams,
    MonthSetupStateResult, MonthSummaryDto, PlanEntryDto, RankedCategoryDto,
    ResolveCategoryNameParams, ResolveCategoryNameResult, SuggestPlanParams, SuggestPlanResult,
    SuggestedRowDto, TransactionDto,
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
                        planned: decimal_to_f64(l.planned),
                        rollover: decimal_to_f64(l.rollover),
                        spent: decimal_to_f64(l.spent),
                        remaining: decimal_to_f64(l.remaining),
                    })
                    .collect(),
                summary: Some(MonthSummaryDto {
                    income: decimal_to_f64(summary.income),
                    total_planned: decimal_to_f64(summary.total_planned),
                    total_spent: decimal_to_f64(summary.total_spent),
                    unassigned: decimal_to_f64(summary.unassigned),
                    unspent: decimal_to_f64(summary.unspent),
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
                planned: decimal_to_f64(l.planned),
                rollover: decimal_to_f64(l.rollover),
                spent: decimal_to_f64(l.spent),
                remaining: decimal_to_f64(l.remaining),
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
                score: decimal_to_f64(r.score),
                uses: r.uses,
            })
            .collect(),
        error: None,
    }
}

/// Each category's share of a total -- the donut's wedge sizes and the
/// ranked rows' percent labels. See `budget_calc::category_shares`.
#[wasm_bindgen]
pub fn category_shares(params: JsValue) -> JsValue {
    to_js(&category_shares_impl(params))
}

fn category_shares_impl(params: JsValue) -> CategorySharesResult {
    let params: CategorySharesParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        return CategorySharesResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let entries: Option<Vec<(String, rust_decimal::Decimal)>> = params
        .entries
        .iter()
        .map(|e| Some((e.category_id.clone(), f64_to_decimal(e.amount)?)))
        .collect();

    let Some(entries) = entries else {
        return CategorySharesResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    CategorySharesResult {
        shares: budget_calc::category_shares(&entries)
            .into_iter()
            .map(|s| CategoryShareDto {
                category_id: s.category_id,
                amount: decimal_to_f64(s.amount),
                share: decimal_to_f64(s.share),
            })
            .collect(),
        error: None,
    }
}

/// Which of the Overview hero's seven states a month is in. See
/// `budget_calc::month_setup_state`.
#[wasm_bindgen]
pub fn month_setup_state(params: JsValue) -> JsValue {
    to_js(&month_setup_state_impl(params))
}

fn month_setup_state_impl(params: JsValue) -> MonthSetupStateResult {
    let params: MonthSetupStateParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        return MonthSetupStateResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let (Some(income), Some(unassigned)) = (
        f64_to_decimal(params.income),
        f64_to_decimal(params.unassigned),
    ) else {
        return MonthSetupStateResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let position = match params.position.as_str() {
        "past" => budget_calc::MonthPosition::Past,
        "current" => budget_calc::MonthPosition::Current,
        "future" => budget_calc::MonthPosition::Future,
        // An unrecognised position is a caller bug, not a user one --
        // refuse rather than guessing "current" and confidently showing
        // the wrong hero for the month on screen.
        _ => {
            return MonthSetupStateResult {
                error: Some(Message::bad_request().text),
                ..Default::default()
            }
        }
    };

    let state = budget_calc::month_setup_state(budget_calc::MonthFacts {
        position,
        has_transactions: params.has_transactions,
        has_plan: params.has_plan,
        has_previous_plan: params.has_previous_plan,
        income,
        unassigned,
    });
    let state = match state {
        budget_calc::MonthSetupState::OtherMonthEmpty => "other_month_empty",
        budget_calc::MonthSetupState::SetupCarryPlan => "setup_carry_plan",
        budget_calc::MonthSetupState::MonthEndedReview => "month_ended_review",
        budget_calc::MonthSetupState::SetupPlanIncome => "setup_plan_income",
        budget_calc::MonthSetupState::SetupAssignRemaining => "setup_assign_remaining",
        budget_calc::MonthSetupState::SetupLogTransaction => "setup_log_transaction",
        budget_calc::MonthSetupState::SpentSoFar => "spent_so_far",
        budget_calc::MonthSetupState::SavingsUnassigned => "savings_unassigned",
        budget_calc::MonthSetupState::SavingsComplete => "savings_complete",
    };

    MonthSetupStateResult {
        state: Some(state.to_string()),
        error: None,
    }
}

/// The previous month's plan, rewritten for a new month. See
/// `budget_calc::carry_plan_forward`.
#[wasm_bindgen]
pub fn carry_plan_forward(params: JsValue) -> JsValue {
    to_js(&carry_plan_forward_impl(params))
}

fn carry_plan_forward_impl(params: JsValue) -> CarryPlanResult {
    let params: CarryPlanParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        return CarryPlanResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let previous: Option<Vec<budget_calc::PlanEntry>> = params
        .previous
        .iter()
        .map(|e| {
            Some(budget_calc::PlanEntry {
                category_id: e.category_id.clone(),
                planned: f64_to_decimal(e.planned)?,
            })
        })
        .collect();

    let Some(previous) = previous else {
        return CarryPlanResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let carried = budget_calc::carry_plan_forward(&previous, &params.existing_category_ids);

    CarryPlanResult {
        entries: carried
            .entries
            .into_iter()
            .map(|e| PlanEntryDto {
                category_id: e.category_id,
                planned: decimal_to_f64(e.planned),
            })
            .collect(),
        dropped_missing_category: carried.dropped_missing_category,
        dropped_zero: carried.dropped_zero,
        error: None,
    }
}

/// How a finished month went. See `budget_calc::month_review`.
#[wasm_bindgen]
pub fn month_review(params: JsValue) -> JsValue {
    to_js(&month_review_impl(params))
}

fn month_review_impl(params: JsValue) -> MonthReviewResult {
    let params: MonthReviewParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        return MonthReviewResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let lines: Option<Vec<budget_calc::CategoryLine>> = params
        .lines
        .iter()
        .map(|l| {
            Some(budget_calc::CategoryLine {
                category_id: l.category_id.clone(),
                planned: f64_to_decimal(l.planned)?,
                rollover: f64_to_decimal(l.rollover)?,
                spent: f64_to_decimal(l.spent)?,
                remaining: f64_to_decimal(l.remaining)?,
            })
        })
        .collect();

    let summary = (|| {
        Some(budget_calc::MonthSummary {
            income: f64_to_decimal(params.summary.income)?,
            total_planned: f64_to_decimal(params.summary.total_planned)?,
            total_spent: f64_to_decimal(params.summary.total_spent)?,
            unassigned: f64_to_decimal(params.summary.unassigned)?,
            unspent: f64_to_decimal(params.summary.unspent)?,
        })
    })();

    let (Some(lines), Some(summary)) = (lines, summary) else {
        return MonthReviewResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let review = budget_calc::month_review(&lines, &summary, &params.income_category_ids);
    let delta = |d: budget_calc::CategoryDelta| CategoryDeltaDto {
        category_id: d.category_id,
        planned: decimal_to_f64(d.planned),
        spent: decimal_to_f64(d.spent),
        delta: decimal_to_f64(d.delta),
    };

    MonthReviewResult {
        income: decimal_to_f64(review.income),
        total_planned: decimal_to_f64(review.total_planned),
        total_spent: decimal_to_f64(review.total_spent),
        saved: decimal_to_f64(review.saved),
        biggest_overspend: review.biggest_overspend.map(delta),
        biggest_underspend: review.biggest_underspend.map(delta),
        error: None,
    }
}

/// A whole month's plan proposed from what's already been logged. See
/// `budget_calc::suggest_plan_from_spending`.
#[wasm_bindgen]
pub fn suggest_plan_from_spending(params: JsValue) -> JsValue {
    to_js(&suggest_plan_from_spending_impl(params))
}

fn transaction_from_dto(dto: &TransactionDto) -> Option<budget_calc::Transaction> {
    let mut t = budget_calc::Transaction::new(
        dto.id.clone(),
        dto.date.clone(),
        dto.description.clone(),
        f64_to_decimal(dto.amount)?,
    );
    t.category_id = dto.category_id.clone();
    Some(t)
}

/// Built field by field rather than through `Category::new`, which rejects
/// a blank name: a category the app has already stored is not this
/// binding's to re-validate, and refusing the whole suggestion over one
/// odd name would hide every other row behind a generic bad-request.
fn category_from_dto(dto: &CategoryDto) -> budget_calc::Category {
    budget_calc::Category {
        id: dto.id.clone(),
        name: dto.name.clone(),
        group: dto.group.clone(),
        is_income: dto.is_income,
        description: dto.description.clone(),
    }
}

fn suggest_plan_from_spending_impl(params: JsValue) -> SuggestPlanResult {
    fn failed(message: Message) -> SuggestPlanResult {
        SuggestPlanResult {
            error: Some(message.text),
            ..Default::default()
        }
    }

    let Ok(params) = serde_wasm_bindgen::from_value::<SuggestPlanParams>(params) else {
        return failed(Message::bad_request());
    };

    let Some(transactions) = params
        .transactions
        .iter()
        .map(transaction_from_dto)
        .collect::<Option<Vec<_>>>()
    else {
        return failed(Message::bad_request());
    };

    let income_override = match params.income_override {
        Some(entry) => {
            let Some(planned) = f64_to_decimal(entry.planned) else {
                return failed(Message::bad_request());
            };
            Some(budget_calc::PlanEntry {
                category_id: entry.category_id,
                planned,
            })
        }
        None => None,
    };

    let categories: Vec<budget_calc::Category> =
        params.categories.iter().map(category_from_dto).collect();

    let plan = budget_calc::suggest_plan_from_spending(
        &transactions,
        &categories,
        &params.plan_month,
        income_override,
    );

    let state = match plan.state {
        budget_calc::PlanSuggestionState::NotEnoughLogged => "not_enough_logged",
        budget_calc::PlanSuggestionState::NeedsCategorizing => "needs_categorizing",
        budget_calc::PlanSuggestionState::NoIncomeObserved => "no_income_observed",
        budget_calc::PlanSuggestionState::Ready => "ready",
    };
    let basis = plan.basis.map(|b| {
        match b {
            budget_calc::PlanBasis::CompleteMonths => "complete_months",
            budget_calc::PlanBasis::PartialMonth => "partial_month",
        }
        .to_string()
    });

    SuggestPlanResult {
        state: state.to_string(),
        basis,
        months_observed: plan.months_observed,
        transactions_used: plan.transactions_used,
        uncategorized: plan.uncategorized,
        rows: plan
            .rows
            .into_iter()
            .map(|r| SuggestedRowDto {
                category_id: r.category_id,
                observed: decimal_to_f64(r.observed),
                planned: decimal_to_f64(r.planned),
                is_income: r.is_income,
            })
            .collect(),
        entries: plan
            .entries
            .into_iter()
            .map(|e| PlanEntryDto {
                category_id: e.category_id,
                planned: decimal_to_f64(e.planned),
            })
            .collect(),
        total_income: decimal_to_f64(plan.total_income),
        total_expenses: decimal_to_f64(plan.total_expenses),
        savings: plan.savings.map(decimal_to_f64),
        shortfall: plan.shortfall.map(decimal_to_f64),
        error: None,
    }
}

/// `budget_calc::resolve_category_name`.
#[wasm_bindgen]
pub fn resolve_category_name(params: JsValue) -> JsValue {
    to_js(&resolve_category_name_impl(params))
}

fn resolve_category_name_impl(params: JsValue) -> ResolveCategoryNameResult {
    let params: ResolveCategoryNameParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        return ResolveCategoryNameResult {
            error: Some(Message::bad_request().text),
            ..Default::default()
        };
    };

    let direction = match params.direction.as_str() {
        "income" => budget_calc::Direction::Income,
        "expense" => budget_calc::Direction::Expense,
        _ => {
            return ResolveCategoryNameResult {
                error: Some(Message::bad_request().text),
                ..Default::default()
            }
        }
    };

    let existing: Vec<budget_calc::NamedCategory> = params
        .existing
        .into_iter()
        .map(|c| budget_calc::NamedCategory {
            id: c.id,
            name: c.name,
            is_income: c.is_income,
        })
        .collect();
    let presets: Vec<budget_calc::NamedPreset> = params
        .presets
        .into_iter()
        .map(|p| budget_calc::NamedPreset {
            key: p.key,
            name: p.name,
            is_income: p.is_income,
        })
        .collect();

    let outcome = budget_calc::resolve_category_name(&params.typed, direction, &existing, &presets);

    let named = |outcome: &str| ResolveCategoryNameResult {
        outcome: Some(outcome.to_string()),
        ..Default::default()
    };
    match outcome {
        budget_calc::NewCategoryOutcome::Blank => named("blank"),
        budget_calc::NewCategoryOutcome::Existing { category_id } => ResolveCategoryNameResult {
            category_id: Some(category_id),
            ..named("existing")
        },
        budget_calc::NewCategoryOutcome::OtherDirection { category_id } => {
            ResolveCategoryNameResult {
                category_id: Some(category_id),
                ..named("other_direction")
            }
        }
        budget_calc::NewCategoryOutcome::Preset { preset_key } => ResolveCategoryNameResult {
            preset_key: Some(preset_key),
            ..named("preset")
        },
        budget_calc::NewCategoryOutcome::Create { name, group_key } => ResolveCategoryNameResult {
            name: Some(name),
            group_key: Some(group_key),
            ..named("create")
        },
    }
}
