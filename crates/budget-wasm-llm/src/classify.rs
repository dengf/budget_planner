//! `classify_statement_rows`.
//!
//! The model and tokenizer bytes cross as direct `&[u8]` wasm-bindgen
//! parameters, same reason as `budget-wasm-ocr`'s `run_ocr`: these are
//! multi-megabyte payloads, not the small structured params
//! `serde_wasm_bindgen` is used for elsewhere. `descriptions` stays a
//! plain `Vec<String>` -- wasm-bindgen maps it to/from a JS array of
//! strings directly, and a batch of short descriptions is nowhere near
//! large enough to need the typed-array treatment.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::ClassifyStatementRowsResult;

#[wasm_bindgen]
pub fn classify_statement_rows(
    model_bytes: &[u8],
    tokenizer_json: &[u8],
    descriptions: Vec<String>,
) -> JsValue {
    to_js(&match budget_calc::classify_statement_descriptions(
        model_bytes.to_vec(),
        tokenizer_json,
        &descriptions,
    ) {
        Ok(predictions) => ClassifyStatementRowsResult {
            predictions: predictions.into_iter().map(Some).collect(),
            error: None,
            error_message: None,
        },
        Err(e) => {
            let message = Message::from(&e);
            ClassifyStatementRowsResult {
                predictions: vec![None; descriptions.len()],
                error: Some(message.text.clone()),
                error_message: Some(message),
            }
        }
    })
}
