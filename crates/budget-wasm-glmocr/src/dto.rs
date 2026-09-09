//! Result DTOs for this crate's `SmartParseSession` binding. The three
//! model files (each a graph + external-data pair), the tokenizer and
//! the image all cross as direct buffer wasm-bindgen parameters rather
//! than fields on a serde_wasm_bindgen params struct -- same reason as
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

/// Result of one `SmartParseSession::load_vision`/`load_embed`/
/// `load_decoder` call -- no payload beyond success/failure, since the
/// loaded model stays inside the session rather than crossing back to JS.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LoadModelResult {
    pub error: Option<String>,
    pub error_message: Option<Message>,
}
