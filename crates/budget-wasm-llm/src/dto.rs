//! Result DTO for this crate's one binding.

use budget_core::Message;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct ClassifyStatementRowsResult {
    /// Same length and order as the request's descriptions. `None` for
    /// every entry when classification failed (see `error`) -- the
    /// caller falls back to whatever direction the heuristic already
    /// guessed rather than blocking on this.
    pub predictions: Vec<Option<bool>>,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}
