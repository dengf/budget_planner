//! `recurring_occurrences`, `recurring_status`, `occurrence_payment`.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, f64_to_decimal, parse_cadence, to_js};
use crate::dto::{
    AmountResultDto, OccurrenceDto, OccurrencePaymentParams, OccurrencePaymentResult,
    OccurrenceStatusDto, OccurrencesParams, OccurrencesResult, RecurringStatusParams,
    RecurringStatusResult,
};
use crate::message::Message;

fn from_dto(dto: &crate::dto::RecurringExpenseDto) -> Option<budget_calc::RecurringExpense> {
    budget_calc::RecurringExpense::new(
        dto.id.clone(),
        dto.description.clone(),
        dto.category_id.clone(),
        f64_to_decimal(dto.amount)?,
        parse_cadence(Some(&dto.cadence)),
        dto.anchor_date.clone(),
    )
    .ok()
}

fn occurrence_to_dto(o: budget_calc::Occurrence) -> OccurrenceDto {
    OccurrenceDto {
        recurring_id: o.recurring_id,
        category_id: o.category_id,
        description: o.description,
        amount: decimal_to_f64(o.amount),
        date: o.date,
    }
}

fn occurrence_from_dto(dto: &OccurrenceDto) -> Option<budget_calc::Occurrence> {
    Some(budget_calc::Occurrence {
        recurring_id: dto.recurring_id.clone(),
        category_id: dto.category_id.clone(),
        description: dto.description.clone(),
        amount: f64_to_decimal(dto.amount)?,
        date: dto.date.clone(),
    })
}

#[wasm_bindgen]
pub fn recurring_occurrences(params: JsValue) -> JsValue {
    to_js(&recurring_occurrences_impl(params))
}

fn recurring_occurrences_impl(params: JsValue) -> OccurrencesResult {
    let params: OccurrencesParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        let message = Message::bad_request();
        return OccurrencesResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        };
    };

    // A malformed individual record (bad amount, corrupted from storage)
    // is dropped rather than failing the whole month's view -- one
    // damaged recurring expense should not hide every other one's
    // upcoming dates.
    let expenses: Vec<_> = params.recurring.iter().filter_map(from_dto).collect();

    let occurrences = budget_calc::occurrences_for_month(&expenses, &params.month);
    let totals = budget_calc::totals_by_category(&occurrences);

    OccurrencesResult {
        occurrences: occurrences.into_iter().map(occurrence_to_dto).collect(),
        totals_by_category: totals
            .into_iter()
            .map(|(category_id, amount)| AmountResultDto {
                category_id,
                amount: decimal_to_f64(amount),
            })
            .collect(),
        error: None,
        error_message: None,
    }
}

/// This month's occurrences, each marked paid or still due -- see
/// `budget_calc::match_occurrences` for what counts as a match.
///
/// One call, not two: the count of what is still due comes back beside
/// the rows it describes, so a "3 still due" badge cannot disagree with
/// the list it opens.
#[wasm_bindgen]
pub fn recurring_status(params: JsValue) -> JsValue {
    to_js(&recurring_status_impl(params))
}

fn recurring_status_impl(params: JsValue) -> RecurringStatusResult {
    fn failed(message: Message) -> RecurringStatusResult {
        RecurringStatusResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        }
    }
    let Ok(params) = serde_wasm_bindgen::from_value::<RecurringStatusParams>(params) else {
        return failed(Message::bad_request());
    };

    // Same reasoning as `recurring_occurrences` above: one damaged record
    // is dropped rather than hiding every other one's status.
    let expenses: Vec<_> = params.recurring.iter().filter_map(from_dto).collect();
    let occurrences = budget_calc::occurrences_for_month(&expenses, &params.month);

    let mut transactions = Vec::with_capacity(params.transactions.len());
    for dto in &params.transactions {
        let Some(amount) = f64_to_decimal(dto.amount) else {
            return failed(Message::bad_request());
        };
        transactions.push(budget_calc::Transaction {
            id: dto.id.clone(),
            date: dto.date.clone(),
            description: dto.description.clone(),
            amount,
            category_id: dto.category_id.clone(),
        });
    }

    let statuses = budget_calc::match_occurrences(&occurrences, &transactions);
    let unpaid_count = statuses.iter().filter(|s| !s.paid).count();
    let unpaid_total = statuses
        .iter()
        .filter(|s| !s.paid)
        .map(|s| s.occurrence.amount)
        .sum();

    RecurringStatusResult {
        unpaid_count,
        unpaid_total: decimal_to_f64(unpaid_total),
        statuses: statuses
            .into_iter()
            .map(|s| OccurrenceStatusDto {
                occurrence: occurrence_to_dto(s.occurrence),
                paid: s.paid,
                transaction_id: s.transaction_id,
            })
            .collect(),
        error: None,
        error_message: None,
    }
}

/// The transaction that settles an occurrence -- see
/// `budget_calc::payment_for_occurrence`.
///
/// The sign, the date and the category all come from the core, so a
/// "mark as paid" row is by construction one the next
/// `recurring_status` call will recognise as settling it.
#[wasm_bindgen]
pub fn occurrence_payment(params: JsValue) -> JsValue {
    to_js(&occurrence_payment_impl(params))
}

fn occurrence_payment_impl(params: JsValue) -> OccurrencePaymentResult {
    fn failed(message: Message) -> OccurrencePaymentResult {
        OccurrencePaymentResult {
            error: Some(message.text.clone()),
            error_message: Some(message),
            ..Default::default()
        }
    }
    let Ok(params) = serde_wasm_bindgen::from_value::<OccurrencePaymentParams>(params) else {
        return failed(Message::bad_request());
    };
    let Some(occurrence) = occurrence_from_dto(&params.occurrence) else {
        return failed(Message::bad_request());
    };

    let payment = budget_calc::payment_for_occurrence(&occurrence);
    OccurrencePaymentResult {
        date: payment.date,
        description: payment.description,
        amount: decimal_to_f64(payment.amount),
        category_id: payment.category_id,
        error: None,
        error_message: None,
    }
}
