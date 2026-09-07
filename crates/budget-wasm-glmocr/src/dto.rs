//! Result DTO for this crate's one binding. The three model files (each
//! a graph + external-data pair), the tokenizer and the image all cross
//! as direct `&[u8]` wasm-bindgen parameters rather than fields on a
//! serde_wasm_bindgen params struct -- same reason as
//! `budget-wasm-ocr::dto`: routing multi-megabyte buffers through
//! serde_wasm_bindgen would encode every byte as a JS array element
//! instead of a typed array.

use budget_core::Message;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct RunSmartParseResult {
    pub text: String,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}
