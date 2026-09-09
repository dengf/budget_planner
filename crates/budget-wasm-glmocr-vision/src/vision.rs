//! `VisionEncoder`.
//!
//! Exposed as an incrementally-built session object, not a single
//! function taking the whole external-data buffer -- see
//! `budget_calc::smart_parse_model`'s own doc comment for why:
//! `www/src/ocrWorker.js` downloads the ~800MB-to-1GB-scale weights file
//! in tens-of-MB range-request chunks, feeding each chunk to
//! `append_data_chunk` as it arrives and finishing with `finish`,
//! instead of ever handing this crate one huge buffer in a single call.
//! `finish` takes the (small) graph buffer as `Vec<u8>` by value, not
//! `&[u8]`, so wasm-bindgen's own JS-to-wasm copy becomes the owned
//! buffer `budget_calc` stores.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::LoadModelResult;

#[wasm_bindgen]
pub struct VisionEncoder {
    inner: budget_calc::VisionEncoder,
}

impl Default for VisionEncoder {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl VisionEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> VisionEncoder {
        VisionEncoder {
            inner: budget_calc::VisionEncoder::new(),
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

    /// Returns the flat image-feature buffer as a raw `Float32Array`
    /// (`Result<Vec<f32>, JsValue>`, not this crate's usual
    /// `to_js`-wrapped DTO) -- wrapping a multi-megabyte `Vec<f32>` in a
    /// serde_wasm_bindgen struct would serialize it as a plain JS array
    /// (one boxed float per element), the same cost
    /// `budget-wasm-pdfrender::render_pdf_page` already avoids for its
    /// `Vec<u8>` return -- see that crate's own doc comment. On error,
    /// throws the `Message`-shaped `JsValue` directly (still via
    /// `to_js`, never Debug-formatted); `www/src/ocrWorker.js`'s
    /// orchestration loop catches it the same way for every other
    /// hot-path call across all four Smart Parse wasm modules.
    pub fn encode(
        &self,
        pixel_values: &[f32],
        grid_h: u32,
        grid_w: u32,
    ) -> Result<Vec<f32>, JsValue> {
        self.inner
            .encode(pixel_values, grid_h as i64, grid_w as i64)
            .map_err(|e| to_js(&Message::from(&e)))
    }
}
