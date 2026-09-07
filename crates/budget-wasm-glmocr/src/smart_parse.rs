//! `run_smart_parse`.
//!
//! Nine buffer parameters, not a struct -- three ONNX models (each a
//! graph file plus its external-data weights file, since GLM-OCR's fp16
//! export is too large for a single-file ONNX graph) plus a tokenizer
//! and an image, all multi-megabyte-to-gigabyte payloads. Same direct
//! `&[u8]` convention as `budget-wasm-ocr::run_ocr` and
//! `budget-wasm-llm::classify_statement_rows`, just with more of them.

use budget_core::Message;
use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::RunSmartParseResult;

#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn run_smart_parse(
    vision_graph: &[u8],
    vision_data: &[u8],
    embed_graph: &[u8],
    embed_data: &[u8],
    decoder_graph: &[u8],
    decoder_data: &[u8],
    tokenizer_json: &[u8],
    image_rgb: &[u8],
    width: u32,
    height: u32,
) -> JsValue {
    to_js(&match budget_calc::run_smart_parse(
        vision_graph.to_vec(),
        vision_data.to_vec(),
        embed_graph.to_vec(),
        embed_data.to_vec(),
        decoder_graph.to_vec(),
        decoder_data.to_vec(),
        tokenizer_json,
        image_rgb,
        width,
        height,
    ) {
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
    })
}
