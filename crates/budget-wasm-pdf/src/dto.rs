//! Result DTO for this crate's one binding.

use budget_core::Message;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct ExtractPdfTextResult {
    pub text: String,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}
