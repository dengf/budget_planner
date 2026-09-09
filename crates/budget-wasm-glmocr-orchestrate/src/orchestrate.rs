//! Stateless bindings over `budget_calc::smart_parse_orchestrate` --
//! see that module's own doc comment for the actual logic. Every
//! fallible function here throws a `Message`-shaped `JsValue` directly
//! on error rather than returning this crate's usual DTO convention (it
//! has none -- see this crate's `lib.rs` doc comment), matching the
//! hot-path convention `budget-wasm-glmocr-vision::VisionEncoder::encode`
//! established.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;

/// The vision-encoder patch grid `(grid_h, grid_w)` a `width`x`height`
/// image resizes to, as a two-element array (tuples don't cross the
/// wasm boundary).
#[wasm_bindgen]
pub fn patch_grid(width: u32, height: u32) -> Result<Vec<u32>, JsValue> {
    budget_calc::patch_grid(width, height)
        .map(|(grid_h, grid_w)| vec![grid_h as u32, grid_w as u32])
        .map_err(|e| to_js(&Message::from(&e)))
}

/// Resizes and patchifies a raw RGB image into GLM-OCR's expected flat
/// patch layout.
#[wasm_bindgen]
pub fn patchify(rgb: &[u8], width: u32, height: u32) -> Result<Vec<f32>, JsValue> {
    budget_calc::patchify(rgb, width, height).map_err(|e| to_js(&Message::from(&e)))
}

/// Builds GLM-OCR's fixed chat-template token sequence for a
/// single-image "Text Recognition" turn.
#[wasm_bindgen]
pub fn build_input_ids(tokenizer_json: &[u8], num_image_tokens: u32) -> Result<Vec<i32>, JsValue> {
    budget_calc::build_input_ids_from_json(tokenizer_json, num_image_tokens as usize)
        .map_err(|e| to_js(&Message::from(&e)))
}

/// Computes the mrope position ids for `input_ids`, flat and
/// channel-major (length `3 * input_ids.len()`).
#[wasm_bindgen]
pub fn rope_index(input_ids: &[i32], grid_h: u32, grid_w: u32) -> Vec<i32> {
    budget_calc::get_rope_index(input_ids, grid_h as i64, grid_w as i64)
}

/// Advances channel-major position ids by one greedy-decode step.
#[wasm_bindgen]
pub fn advance_position_ids(prev_position_ids: &[i32], prev_seq_len: u32) -> Vec<i32> {
    budget_calc::advance_position_ids(prev_position_ids, prev_seq_len as usize).to_vec()
}

/// Overwrites `embeds`'s image-token positions in place with
/// `image_features`, in prompt order.
#[wasm_bindgen]
pub fn splice_image_features(
    embeds: &mut [f32],
    image_features: &[f32],
    input_ids: &[i32],
) -> Result<(), JsValue> {
    budget_calc::splice_image_features(embeds, image_features, input_ids)
        .map_err(|e| to_js(&Message::from(&e)))
}

/// Index of the largest value in `logits`.
#[wasm_bindgen]
pub fn argmax(logits: &[f32]) -> u32 {
    budget_calc::argmax(logits) as u32
}

/// Whether `next_id` is one of GLM-OCR's own end-of-sequence token ids.
#[wasm_bindgen]
pub fn is_eos(next_id: i32) -> bool {
    budget_calc::is_eos(next_id)
}

/// Decodes a generated token-id sequence back to text.
#[wasm_bindgen]
pub fn decode_tokens(tokenizer_json: &[u8], generated_ids: &[u32]) -> Result<String, JsValue> {
    budget_calc::decode_tokens(tokenizer_json, generated_ids).map_err(|e| to_js(&Message::from(&e)))
}

/// The greedy-decode loop's authoritative iteration bound -- exposed so
/// `www/src/ocrWorker.js`'s loop never hardcodes this GLM-OCR-specific
/// constant separately from the Rust value it must match.
#[wasm_bindgen]
pub fn max_new_tokens() -> u32 {
    budget_calc::MAX_NEW_TOKENS as u32
}

/// GLM-OCR's hidden size -- lets a caller derive `num_image_tokens` as
/// `image_features.len() / hidden_size()` without hardcoding 1536.
#[wasm_bindgen]
pub fn hidden_size() -> u32 {
    budget_calc::HIDDEN_SIZE as u32
}
