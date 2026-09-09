//! `DecoderSession`.
//!
//! Exposed as an incrementally-built session object, not a single
//! function taking the whole external-data buffer -- same reasoning as
//! `budget-wasm-glmocr-vision::vision`'s own doc comment. Unlike
//! vision/embed, this session is also stateful *after* loading -- see
//! this crate's own `lib.rs` doc comment for the `reset()` contract.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::LoadModelResult;

#[wasm_bindgen]
pub struct DecoderSession {
    inner: budget_calc::DecoderSession,
}

impl Default for DecoderSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl DecoderSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> DecoderSession {
        DecoderSession {
            inner: budget_calc::DecoderSession::new(),
        }
    }

    pub fn begin_data(&mut self, total_len: u32) {
        self.inner.begin_data(total_len as usize);
    }

    pub fn append_data_chunk(&mut self, chunk: &[u8]) {
        self.inner.append_data_chunk(chunk);
    }

    pub fn finish(&mut self, graph: Vec<u8>) -> JsValue {
        to_js(&match self.inner.finish(graph) {
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

    /// Clears the KV cache. **Must be called before the first `step()`
    /// of every new image's generation** -- see this crate's own
    /// `lib.rs` doc comment.
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// Runs one greedy-decode step, returning flat logits as a raw
    /// `Float32Array` -- same DTO-bypassing reasoning as
    /// `budget-wasm-glmocr-vision::VisionEncoder::encode`'s own doc
    /// comment, and needed even more here: this is called once per
    /// generated token. `inputs_embeds` is a flat `[seq_len *
    /// HIDDEN_SIZE]` buffer; `position_ids` is flat, channel-major,
    /// length `3 * seq_len` (matching
    /// `budget-wasm-glmocr-orchestrate::rope_index`'s/
    /// `advance_position_ids`'s own layout).
    pub fn step(
        &mut self,
        inputs_embeds: &[f32],
        seq_len: u32,
        attention_mask: &[i32],
        position_ids: &[i32],
    ) -> Result<Vec<f32>, JsValue> {
        self.inner
            .step(
                inputs_embeds,
                seq_len as usize,
                attention_mask,
                position_ids,
            )
            .map_err(|e| to_js(&Message::from(&e)))
    }
}
