//! `import_csv`.

use wasm_bindgen::prelude::*;

use crate::convert::{decimal_to_f64, new_record_id, to_js};
use crate::dto::{
    ColumnMappingDto, DetectColumnsResult, ImportCsvParams, ImportCsvResult,
    ImportedTransactionDto, SkippedRowDto, TransactionDto,
};
use crate::message::Message;

fn mapping_from_dto(dto: ColumnMappingDto) -> budget_calc::ColumnMapping {
    budget_calc::ColumnMapping {
        date_col: dto.date_col,
        description_col: dto.description_col,
        amount_col: dto.amount_col,
        credit_col: dto.credit_col,
        has_header: dto.has_header,
    }
}

fn mapping_to_dto(mapping: budget_calc::ColumnMapping) -> ColumnMappingDto {
    ColumnMappingDto {
        date_col: mapping.date_col,
        description_col: mapping.description_col,
        amount_col: mapping.amount_col,
        credit_col: mapping.credit_col,
        has_header: mapping.has_header,
    }
}

/// Guesses a column mapping from the CSV's header row, so the common
/// case needs no manual setup -- see `budget_calc::detect_columns`.
/// `mapping: null` in the result means it couldn't confidently guess;
/// the frontend falls back to its own manual defaults, already visible
/// for exactly this case.
#[wasm_bindgen]
pub fn detect_csv_columns(csv_text: &str) -> JsValue {
    to_js(&DetectColumnsResult {
        mapping: budget_calc::detect_columns(csv_text).map(mapping_to_dto),
    })
}

#[wasm_bindgen]
pub fn import_csv(params: JsValue) -> JsValue {
    to_js(&import_csv_impl(params))
}

fn import_csv_impl(params: JsValue) -> ImportCsvResult {
    let params: ImportCsvParams = match serde_wasm_bindgen::from_value(params) {
        Ok(p) => p,
        Err(_) => {
            let message = Message::bad_request();
            return ImportCsvResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            };
        }
    };

    match budget_calc::import_csv(
        &params.csv_text,
        mapping_from_dto(params.mapping),
        new_record_id,
    ) {
        Ok(outcome) => ImportCsvResult {
            imported: outcome
                .imported
                .into_iter()
                .map(|i| ImportedTransactionDto {
                    transaction: TransactionDto {
                        id: i.transaction.id,
                        date: i.transaction.date,
                        description: i.transaction.description,
                        amount: decimal_to_f64(i.transaction.amount),
                        category_id: i.transaction.category_id,
                    },
                    source_row: i.source_row,
                })
                .collect(),
            skipped: outcome
                .skipped
                .into_iter()
                .map(|s| SkippedRowDto {
                    row: s.row,
                    reason: s.reason,
                })
                .collect(),
            error: None,
            error_message: None,
        },
        Err(e) => {
            let message = Message::from(&e);
            ImportCsvResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
                ..Default::default()
            }
        }
    }
}
