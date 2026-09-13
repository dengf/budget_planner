//! Result DTO for this crate's one binding. The model bytes and the
//! recorded audio cross as direct `&[u8]`/`&[f32]` wasm-bindgen
//! parameters rather than fields on a `serde_wasm_bindgen` params struct
//! -- routing multi-megabyte buffers through `serde_wasm_bindgen` would
//! encode every byte as a JS array element instead of a typed array.

use budget_core::Message;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct TranscribeVoiceCommandResult {
    pub transcript: String,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}
