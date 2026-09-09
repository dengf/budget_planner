//! `SmartParseSession`.
//!
//! Exposed as an incrementally-built session object, not a single
//! function taking nine buffers -- see `budget_calc::SmartParseSession`'s
//! own doc comment for why: `www/src/ocrWorker.js` downloads each of
//! GLM-OCR's three ~200MB-to-1GB-scale models (graph + external-data
//! pair) one at a time and hands each straight to `load_vision`/
//! `load_embed`/`load_decoder` as soon as it finishes, instead of
//! collecting all ~2.2GB of raw bytes in JS before a single call. Buffer
//! params take `Vec<u8>` by value here, not `&[u8]`, so wasm-bindgen's
//! own JS-to-wasm copy becomes the owned buffer `budget_calc` stores --
//! `&[u8]` plus a `.to_vec()` inside would mean a second, redundant
//! ~1GB-scale copy of whichever file is currently loading, on top of the
//! one wasm-bindgen already made crossing the boundary.

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

    pub fn load_vision(&mut self, graph: Vec<u8>, data: Vec<u8>) -> JsValue {
        to_js(&load_result(self.inner.load_vision(graph, data)))
    }

    pub fn load_embed(&mut self, graph: Vec<u8>, data: Vec<u8>) -> JsValue {
        to_js(&load_result(self.inner.load_embed(graph, data)))
    }

    pub fn load_decoder(&mut self, graph: Vec<u8>, data: Vec<u8>) -> JsValue {
        to_js(&load_result(self.inner.load_decoder(graph, data)))
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
