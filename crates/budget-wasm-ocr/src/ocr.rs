//! `run_ocr`.
//!
//! Every buffer here -- the two model files and the image -- crosses as a
//! direct `&[u8]`/typed-array parameter for the same reason
//! `pdf_text.rs`'s binding does: these are multi-megabyte payloads, not
//! the small structured params `serde_wasm_bindgen` is used for
//! elsewhere in this crate.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::RunOcrResult;

#[wasm_bindgen]
pub fn run_ocr(
    detection_model: &[u8],
    recognition_model: &[u8],
    image_rgb: &[u8],
    width: u32,
    height: u32,
) -> JsValue {
    to_js(&match budget_calc::run_ocr(
        detection_model.to_vec(),
        recognition_model.to_vec(),
        image_rgb,
        width,
        height,
    ) {
        Ok(text) => RunOcrResult {
            text,
            error: None,
            error_message: None,
        },
        Err(e) => {
            let message = Message::from(&e);
            RunOcrResult {
                text: String::new(),
                error: Some(message.text.clone()),
                error_message: Some(message),
            }
        }
    })
}
