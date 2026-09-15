//! `apply_rules`, `suggest_rule_keyword`.

use wasm_bindgen::prelude::*;

use crate::convert::{f64_to_decimal, to_js};
use crate::dto::{
    ApplyRulesParams, ApplyRulesResult, RuleDto, SuggestRuleKeywordParams,
    SuggestRuleKeywordResult, TransactionDto,
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

fn to_dto(t: &budget_calc::Transaction) -> TransactionDto {
    TransactionDto {
        id: t.id.clone(),
        date: t.date.clone(),
        description: t.description.clone(),
        amount: crate::convert::decimal_to_f64(t.amount),
        category_id: t.category_id.clone(),
    }
}

fn rule_from_dto(
    dto: &RuleDto,
) -> Result<budget_calc::CategorizationRule, budget_core::BudgetError> {
    budget_calc::CategorizationRule::new(
        dto.id.clone(),
        dto.keyword.clone(),
        dto.category_id.clone(),
        dto.priority,
    )
}

#[wasm_bindgen]
pub fn apply_rules(params: JsValue) -> JsValue {
    to_js(&apply_rules_impl(params))
}

fn apply_rules_impl(params: JsValue) -> ApplyRulesResult {
    let params: ApplyRulesParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        let message = Message::bad_request();
        return ApplyRulesResult {
            error: Some(message.text),
            ..Default::default()
        };
    };

    let Some(mut transactions): Option<Vec<_>> = params.transactions.iter().map(from_dto).collect()
    else {
        let message = Message::bad_request();
        return ApplyRulesResult {
            error: Some(message.text),
            ..Default::default()
        };
    };

    let mut rules = Vec::with_capacity(params.rules.len());
    for dto in &params.rules {
        match rule_from_dto(dto) {
            Ok(r) => rules.push(r),
            Err(e) => {
                let message = Message::from(&e);
                return ApplyRulesResult {
                    error: Some(message.text),
                    ..Default::default()
                };
            }
        }
    }

    budget_calc::apply_rules(&mut transactions, &rules);

    ApplyRulesResult {
        transactions: transactions.iter().map(to_dto).collect(),
        error: None,
    }
}

/// A keyword to propose when someone makes a rule out of a transaction
/// they are looking at -- see `budget_calc::suggest_rule_keyword`. It is
/// a suggestion, not an answer: the caller must show it in an editable
/// field before anything is saved.
#[wasm_bindgen]
pub fn suggest_rule_keyword(params: JsValue) -> JsValue {
    to_js(
        &match serde_wasm_bindgen::from_value::<SuggestRuleKeywordParams>(params) {
            Ok(params) => SuggestRuleKeywordResult {
                keyword: budget_calc::suggest_rule_keyword(&params.description),
                error: None,
            },
            Err(_) => SuggestRuleKeywordResult {
                error: Some(Message::bad_request().text),
                ..Default::default()
            },
        },
    )
}
