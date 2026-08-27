//! `extract_pdf_text`.
//!
//! Takes the PDF's bytes as a direct `&[u8]` parameter rather than a
//! field on a `serde_wasm_bindgen`-decoded params struct: wasm-bindgen
//! maps `&[u8]` to/from a JS `Uint8Array` directly, where routing the
//! same bytes through `serde_wasm_bindgen::from_value` would encode each
//! one as a JS array element -- fine for the small structured params
//! every other binding takes, wasteful for a multi-megabyte file.

use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::ExtractPdfTextResult;
use crate::message::Message;

#[wasm_bindgen]
pub fn extract_pdf_text(bytes: &[u8]) -> JsValue {
    to_js(&match budget_calc::extract_pdf_text(bytes) {
        Ok(text) => ExtractPdfTextResult {
            text,
            error: None,
            error_message: None,
        },
        Err(e) => {
            let message = Message::from(&e);
            ExtractPdfTextResult {
                text: String::new(),
                error: Some(message.text.clone()),
                error_message: Some(message),
            }
        }
    })
}
