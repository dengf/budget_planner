//! `transcribe_voice_command`.
//!
//! The model file and the recorded audio both cross as direct
//! `&[u8]`/`&[f32]`/typed-array parameters for the same reason
//! `budget-wasm-ocr::ocr`'s binding does: these are multi-megabyte
//! payloads, not the small structured params `serde_wasm_bindgen` is
//! used for elsewhere.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::TranscribeVoiceCommandResult;

#[wasm_bindgen]
pub fn transcribe_voice_command(model_bytes: &[u8], samples: &[f32]) -> JsValue {
    to_js(
        &match budget_calc::transcribe_voice_command(model_bytes.to_vec(), samples) {
            Ok(transcript) => TranscribeVoiceCommandResult {
                transcript,
                error: None,
                error_message: None,
            },
            Err(e) => {
                let message = Message::from(&e);
                TranscribeVoiceCommandResult {
                    transcript: String::new(),
                    error: Some(message.text.clone()),
                    error_message: Some(message),
                }
            }
        },
    )
}
