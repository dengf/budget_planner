//! `init_storage`, and save/list/delete for each of the six collections.
//!
//! The open [`RedbBudgetStore`] lives in a thread-local `Rc`, matching
//! mortgage-wasm's `storage.rs` -- wasm32 is single-threaded, so this is
//! "one instance per page load," and every entrypoint clones the `Rc` out
//! of the `RefCell` *before* any `await`, since holding a borrow across
//! one would panic the moment two calls interleave.

use std::cell::RefCell;
use std::rc::Rc;

use budget_ports::{
    BudgetPlanRecord, BudgetStore, CategorizationRuleRecord, CategoryRecord, DebtRecord,
    GoalRecord, TransactionRecord,
};
use wasm_bindgen::prelude::*;

use crate::convert::{
    decimal_to_f64, decimal_to_string, f64_to_decimal, percent_to_rate, rate_to_percent,
    string_to_decimal, to_js,
};
use crate::dto::{
    BudgetPlanEntryDto, CategoryDto, DebtRecordDto, DeleteResult, GoalDto, RuleDto, SaveResult,
    TransactionDto,
};

thread_local! {
    static STORE: RefCell<Option<Rc<budget_ext_redb::RedbBudgetStore>>> = const { RefCell::new(None) };
}

fn get_store() -> Result<Rc<budget_ext_redb::RedbBudgetStore>, String> {
    STORE.with(|cell| {
        cell.borrow()
            .clone()
            .ok_or_else(|| "storage not initialized; call init_storage() first".to_string())
    })
}

/// Must be called (and awaited) once before any other function in this
/// module -- it loads any previously-persisted data from IndexedDB and
/// opens the in-memory-backed redb database against it.
#[wasm_bindgen]
pub async fn init_storage() -> Result<(), JsValue> {
    let store = budget_ext_redb::RedbBudgetStore::open_wasm()
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    STORE.with(|cell| *cell.borrow_mut() = Some(Rc::new(store)));
    Ok(())
}

// ---- categories -------------------------------------------------------

#[wasm_bindgen]
pub async fn save_category(dto: JsValue) -> JsValue {
    let Ok(dto) = serde_wasm_bindgen::from_value::<CategoryDto>(dto) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&SaveResult {
                error: Some(e),
                ..Default::default()
            })
        }
    };
    let record = CategoryRecord {
        id: dto.id.clone(),
        name: dto.name,
        group: dto.group,
    };
    match store.save_category(record).await {
        Ok(()) => to_js(&SaveResult {
            id: Some(dto.id),
            error: None,
        }),
        Err(e) => to_js(&SaveResult {
            error: Some(e.to_string()),
            ..Default::default()
        }),
    }
}

#[wasm_bindgen]
pub async fn list_categories() -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(_) => return to_js(&Vec::<CategoryDto>::new()),
    };
    match store.list_categories().await {
        Ok(records) => to_js(
            &records
                .into_iter()
                .map(|r| CategoryDto {
                    id: r.id,
                    name: r.name,
                    group: r.group,
                })
                .collect::<Vec<_>>(),
        ),
        Err(_) => to_js(&Vec::<CategoryDto>::new()),
    }
}

#[wasm_bindgen]
pub async fn delete_category(id: String) -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&DeleteResult {
                error: Some(e),
                success: false,
            })
        }
    };
    match store.delete_category(&id).await {
        Ok(()) => to_js(&DeleteResult {
            success: true,
            error: None,
        }),
        Err(e) => to_js(&DeleteResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

// ---- transactions -------------------------------------------------------

fn transaction_to_record(dto: &TransactionDto) -> Option<TransactionRecord> {
    Some(TransactionRecord {
        id: dto.id.clone(),
        date: dto.date.clone(),
        description: dto.description.clone(),
        amount: decimal_to_string(f64_to_decimal(dto.amount)?),
        category_id: dto.category_id.clone(),
    })
}

fn transaction_from_record(r: TransactionRecord) -> Option<TransactionDto> {
    Some(TransactionDto {
        id: r.id,
        date: r.date,
        description: r.description,
        amount: decimal_to_f64(string_to_decimal(&r.amount)?),
        category_id: r.category_id,
    })
}

#[wasm_bindgen]
pub async fn save_transaction(dto: JsValue) -> JsValue {
    let Ok(dto) = serde_wasm_bindgen::from_value::<TransactionDto>(dto) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let Some(record) = transaction_to_record(&dto) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&SaveResult {
                error: Some(e),
                ..Default::default()
            })
        }
    };
    match store.save_transaction(record).await {
        Ok(()) => to_js(&SaveResult {
            id: Some(dto.id),
            error: None,
        }),
        Err(e) => to_js(&SaveResult {
            error: Some(e.to_string()),
            ..Default::default()
        }),
    }
}

#[wasm_bindgen]
pub async fn list_transactions() -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(_) => return to_js(&Vec::<TransactionDto>::new()),
    };
    match store.list_transactions().await {
        Ok(records) => to_js(
            &records
                .into_iter()
                .filter_map(transaction_from_record)
                .collect::<Vec<_>>(),
        ),
        Err(_) => to_js(&Vec::<TransactionDto>::new()),
    }
}

#[wasm_bindgen]
pub async fn delete_transaction(id: String) -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&DeleteResult {
                error: Some(e),
                success: false,
            })
        }
    };
    match store.delete_transaction(&id).await {
        Ok(()) => to_js(&DeleteResult {
            success: true,
            error: None,
        }),
        Err(e) => to_js(&DeleteResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

// ---- goals -------------------------------------------------------

#[wasm_bindgen]
pub async fn save_goal(dto: JsValue) -> JsValue {
    let Ok(dto) = serde_wasm_bindgen::from_value::<GoalDto>(dto) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let (Some(target), Some(current)) = (
        f64_to_decimal(dto.target_amount),
        f64_to_decimal(dto.current_amount),
    ) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let record = GoalRecord {
        id: dto.id.clone(),
        name: dto.name,
        target_amount: decimal_to_string(target),
        current_amount: decimal_to_string(current),
        target_date: dto.target_date,
        cadence: dto.cadence,
    };
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&SaveResult {
                error: Some(e),
                ..Default::default()
            })
        }
    };
    match store.save_goal(record).await {
        Ok(()) => to_js(&SaveResult {
            id: Some(dto.id),
            error: None,
        }),
        Err(e) => to_js(&SaveResult {
            error: Some(e.to_string()),
            ..Default::default()
        }),
    }
}

#[wasm_bindgen]
pub async fn list_goals() -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(_) => return to_js(&Vec::<GoalDto>::new()),
    };
    match store.list_goals().await {
        Ok(records) => to_js(
            &records
                .into_iter()
                .filter_map(|r| {
                    Some(GoalDto {
                        id: r.id,
                        name: r.name,
                        target_amount: decimal_to_f64(string_to_decimal(&r.target_amount)?),
                        current_amount: decimal_to_f64(string_to_decimal(&r.current_amount)?),
                        target_date: r.target_date,
                        cadence: r.cadence,
                    })
                })
                .collect::<Vec<_>>(),
        ),
        Err(_) => to_js(&Vec::<GoalDto>::new()),
    }
}

#[wasm_bindgen]
pub async fn delete_goal(id: String) -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&DeleteResult {
                error: Some(e),
                success: false,
            })
        }
    };
    match store.delete_goal(&id).await {
        Ok(()) => to_js(&DeleteResult {
            success: true,
            error: None,
        }),
        Err(e) => to_js(&DeleteResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

// ---- debts -------------------------------------------------------

#[wasm_bindgen]
pub async fn save_debt(dto: JsValue) -> JsValue {
    let Ok(dto) = serde_wasm_bindgen::from_value::<DebtRecordDto>(dto) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let (Some(balance), Some(apr), Some(min_payment)) = (
        f64_to_decimal(dto.balance),
        percent_to_rate(dto.apr_percent),
        f64_to_decimal(dto.min_payment),
    ) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let record = DebtRecord {
        id: dto.id.clone(),
        name: dto.name,
        balance: decimal_to_string(balance),
        apr: decimal_to_string(apr),
        min_payment: decimal_to_string(min_payment),
    };
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&SaveResult {
                error: Some(e),
                ..Default::default()
            })
        }
    };
    match store.save_debt(record).await {
        Ok(()) => to_js(&SaveResult {
            id: Some(dto.id),
            error: None,
        }),
        Err(e) => to_js(&SaveResult {
            error: Some(e.to_string()),
            ..Default::default()
        }),
    }
}

#[wasm_bindgen]
pub async fn list_debts() -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(_) => return to_js(&Vec::<DebtRecordDto>::new()),
    };
    match store.list_debts().await {
        Ok(records) => to_js(
            &records
                .into_iter()
                .filter_map(|r| {
                    Some(DebtRecordDto {
                        id: r.id,
                        name: r.name,
                        balance: decimal_to_f64(string_to_decimal(&r.balance)?),
                        apr_percent: rate_to_percent(string_to_decimal(&r.apr)?),
                        min_payment: decimal_to_f64(string_to_decimal(&r.min_payment)?),
                    })
                })
                .collect::<Vec<_>>(),
        ),
        Err(_) => to_js(&Vec::<DebtRecordDto>::new()),
    }
}

#[wasm_bindgen]
pub async fn delete_debt(id: String) -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&DeleteResult {
                error: Some(e),
                success: false,
            })
        }
    };
    match store.delete_debt(&id).await {
        Ok(()) => to_js(&DeleteResult {
            success: true,
            error: None,
        }),
        Err(e) => to_js(&DeleteResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

// ---- budget plan (one month's planned amounts) -------------------------

#[wasm_bindgen]
pub async fn save_budget_plan_entry(dto: JsValue) -> JsValue {
    let Ok(dto) = serde_wasm_bindgen::from_value::<BudgetPlanEntryDto>(dto) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let Some(planned) = f64_to_decimal(dto.planned) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let record = BudgetPlanRecord {
        id: dto.id.clone(),
        month: dto.month,
        category_id: dto.category_id,
        planned: decimal_to_string(planned),
    };
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&SaveResult {
                error: Some(e),
                ..Default::default()
            })
        }
    };
    match store.save_budget_plan(record).await {
        Ok(()) => to_js(&SaveResult {
            id: Some(dto.id),
            error: None,
        }),
        Err(e) => to_js(&SaveResult {
            error: Some(e.to_string()),
            ..Default::default()
        }),
    }
}

#[wasm_bindgen]
pub async fn list_budget_plan(month: String) -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(_) => return to_js(&Vec::<BudgetPlanEntryDto>::new()),
    };
    match store.list_budget_plan(&month).await {
        Ok(records) => to_js(
            &records
                .into_iter()
                .filter_map(|r| {
                    Some(BudgetPlanEntryDto {
                        id: r.id,
                        month: r.month,
                        category_id: r.category_id,
                        planned: decimal_to_f64(string_to_decimal(&r.planned)?),
                    })
                })
                .collect::<Vec<_>>(),
        ),
        Err(_) => to_js(&Vec::<BudgetPlanEntryDto>::new()),
    }
}

#[wasm_bindgen]
pub async fn delete_budget_plan_entry(id: String) -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&DeleteResult {
                error: Some(e),
                success: false,
            })
        }
    };
    match store.delete_budget_plan(&id).await {
        Ok(()) => to_js(&DeleteResult {
            success: true,
            error: None,
        }),
        Err(e) => to_js(&DeleteResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}

// ---- categorization rules -------------------------------------------------

#[wasm_bindgen]
pub async fn save_rule(dto: JsValue) -> JsValue {
    let Ok(dto) = serde_wasm_bindgen::from_value::<RuleDto>(dto) else {
        return to_js(&SaveResult {
            error: Some(crate::message::Message::bad_request().text),
            ..Default::default()
        });
    };
    let record = CategorizationRuleRecord {
        id: dto.id.clone(),
        keyword: dto.keyword,
        category_id: dto.category_id,
        priority: dto.priority,
    };
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&SaveResult {
                error: Some(e),
                ..Default::default()
            })
        }
    };
    match store.save_rule(record).await {
        Ok(()) => to_js(&SaveResult {
            id: Some(dto.id),
            error: None,
        }),
        Err(e) => to_js(&SaveResult {
            error: Some(e.to_string()),
            ..Default::default()
        }),
    }
}

#[wasm_bindgen]
pub async fn list_rules() -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(_) => return to_js(&Vec::<RuleDto>::new()),
    };
    match store.list_rules().await {
        Ok(records) => to_js(
            &records
                .into_iter()
                .map(|r| RuleDto {
                    id: r.id,
                    keyword: r.keyword,
                    category_id: r.category_id,
                    priority: r.priority,
                })
                .collect::<Vec<_>>(),
        ),
        Err(_) => to_js(&Vec::<RuleDto>::new()),
    }
}

#[wasm_bindgen]
pub async fn delete_rule(id: String) -> JsValue {
    let store = match get_store() {
        Ok(s) => s,
        Err(e) => {
            return to_js(&DeleteResult {
                error: Some(e),
                success: false,
            })
        }
    };
    match store.delete_rule(&id).await {
        Ok(()) => to_js(&DeleteResult {
            success: true,
            error: None,
        }),
        Err(e) => to_js(&DeleteResult {
            success: false,
            error: Some(e.to_string()),
        }),
    }
}
