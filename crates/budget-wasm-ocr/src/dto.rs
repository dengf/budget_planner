//! Result DTOs for this crate's three bindings. Byte payloads (a PDF, a
//! photo, an OCR model) cross as direct `&[u8]` wasm-bindgen parameters
//! rather than fields on a serde_wasm_bindgen params struct -- routing
//! multi-megabyte buffers through serde_wasm_bindgen would encode every
//! byte as a JS array element instead of a typed array.

use budget_core::Message;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct ExtractPdfTextResult {
    pub text: String,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RunOcrResult {
    pub text: String,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ParseReceiptTextResult {
    pub description: Option<String>,
    pub amount: Option<f64>,
    pub date: Option<String>,
    pub is_income: bool,
}
