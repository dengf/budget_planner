//! `SmartParseSession`.
//!
//! Exposed as an incrementally-built session object, not a single
//! function taking nine buffers -- see `budget_calc::SmartParseSession`'s
//! own doc comment for why: `www/src/ocrWorker.js` downloads each of
//! GLM-OCR's three ~200MB-to-1GB-scale models (graph + external-data
//! pair) in tens-of-MB range-request chunks, feeding each chunk to
//! `append_data_chunk` as it arrives and finishing with `finish_vision`/
//! `finish_embed`/`finish_decoder`, instead of ever handing this crate
//! one huge buffer in a single call. `finish_vision`/`finish_embed`/
//! `finish_decoder` take the (small) graph buffer as `Vec<u8>` by value,
//! not `&[u8]`, so wasm-bindgen's own JS-to-wasm copy becomes the owned
//! buffer `budget_calc` stores.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::{LoadModelResult, RunSmartParseResult};

#[wasm_bindgen]
pub struct SmartParseSession {
    inner: budget_calc::SmartParseSession,
}

impl Default for SmartParseSession {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl SmartParseSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SmartParseSession {
        SmartParseSession {
            inner: budget_calc::SmartParseSession::new(),
        }
    }

    pub fn begin_data(&mut self, total_len: u32) {
        self.inner.begin_data(total_len as usize);
    }

    pub fn append_data_chunk(&mut self, chunk: &[u8]) {
        self.inner.append_data_chunk(chunk);
    }

    pub fn finish_vision(&mut self, graph: Vec<u8>) -> JsValue {
        to_js(&load_result(self.inner.finish_vision(graph)))
    }

    pub fn finish_embed(&mut self, graph: Vec<u8>) -> JsValue {
        to_js(&load_result(self.inner.finish_embed(graph)))
    }

    pub fn finish_decoder(&mut self, graph: Vec<u8>) -> JsValue {
        to_js(&load_result(self.inner.finish_decoder(graph)))
    }

    pub fn run(&self, tokenizer_json: &[u8], image_rgb: &[u8], width: u32, height: u32) -> JsValue {
        to_js(
            &match self.inner.run(tokenizer_json, image_rgb, width, height) {
                Ok(text) => RunSmartParseResult {
                    text,
                    error: None,
                    error_message: None,
                },
                Err(e) => {
                    let message = Message::from(&e);
                    RunSmartParseResult {
                        text: String::new(),
                        error: Some(message.text.clone()),
                        error_message: Some(message),
                    }
                }
            },
        )
    }
}

fn load_result(result: Result<(), budget_core::BudgetError>) -> LoadModelResult {
    match result {
        Ok(()) => LoadModelResult::default(),
        Err(e) => {
            let message = Message::from(&e);
            LoadModelResult {
                error: Some(message.text.clone()),
                error_message: Some(message),
            }
        }
    }
}
