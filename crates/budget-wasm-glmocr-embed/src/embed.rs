//! `TokenEmbedder`.
//!
//! Exposed as an incrementally-built session object, not a single
//! function taking the whole external-data buffer -- same reasoning as
//! `budget-wasm-glmocr-vision::vision`'s own doc comment.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::LoadModelResult;

#[wasm_bindgen]
pub struct TokenEmbedder {
    inner: budget_calc::TokenEmbedder,
}

impl Default for TokenEmbedder {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl TokenEmbedder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> TokenEmbedder {
        TokenEmbedder {
            inner: budget_calc::TokenEmbedder::new(),
        }
    }

    pub fn begin_data(&mut self, total_len: u32) {
        self.inner.begin_data(total_len as usize);
    }

    pub fn append_data_chunk(&mut self, chunk: &[u8]) {
        self.inner.append_data_chunk(chunk);
    }

    pub fn finish(&mut self) -> JsValue {
        to_js(&match self.inner.finish() {
            Ok(()) => LoadModelResult::default(),
            Err(e) => {
                let message = Message::from(&e);
                LoadModelResult {
                    error: Some(message.text.clone()),
                    error_message: Some(message),
                }
            }
        })
    }

    /// Returns a flat `[input_ids.len() * HIDDEN_SIZE]` embedding buffer
    /// as a raw `Float32Array` -- same DTO-bypassing reasoning as
    /// `budget-wasm-glmocr-vision::VisionEncoder::encode`'s own doc
    /// comment, and needed even more here: this is called once for the
    /// whole prompt and once per generated token thereafter.
    pub fn embed(&self, input_ids: &[i32]) -> Result<Vec<f32>, JsValue> {
        self.inner
            .embed(input_ids)
            .map_err(|e| to_js(&Message::from(&e)))
    }
}
