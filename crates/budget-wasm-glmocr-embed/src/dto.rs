//! Result DTO for this crate's `TokenEmbedder::finish`. `embed` itself
//! returns a raw `Result<Vec<f32>, JsValue>` instead -- see its own doc
//! comment for why a multi-megabyte float buffer doesn't go through this
//! DTO convention.

use budget_core::Message;
use serde::Serialize;

/// Result of `TokenEmbedder::finish` -- no payload beyond success/
/// failure, since the loaded model stays inside the session rather than
/// crossing back to JS.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LoadModelResult {
    pub error: Option<String>,
    pub error_message: Option<Message>,
}
