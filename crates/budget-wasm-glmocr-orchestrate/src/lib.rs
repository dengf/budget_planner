//! Lazily-loaded WebAssembly bindings for GLM-OCR's model-agnostic pure
//! logic (image preprocessing, chat-template construction, mrope
//! position-id math, splicing, argmax, EOS check, tokenizer
//! encode/decode) -- the fourth of four independent wasm modules "Smart
//! Parse" now spans (the others are the sibling
//! `budget-wasm-glmocr-vision`/`-embed`/`-decoder` crates, each holding
//! one of GLM-OCR's three models). See `budget-wasm-glmocr-vision`'s own
//! doc comment for the full 4GiB-ceiling/fp16-doubling rationale behind
//! the split.
//!
//! Unlike its three siblings, this crate has **no `rten`/`rten-tensor`
//! dependency at all** -- nothing here ever runs a model forward pass,
//! so it stays a small, cheap-to-load wasm module with no ML runtime
//! compiled in. It also has **no `dto.rs`**: every function here either
//! returns a bare value or throws a `Message`-shaped `JsValue` directly
//! on failure (see `budget-wasm-glmocr-vision::VisionEncoder::encode`'s
//! own doc comment for why hot-path Smart Parse calls bypass the usual
//! `{ error, error_message }` DTO convention), so there is no crate-
//! local result struct to define.
//!
//! `www/src/ocrWorker.js` calls this module's functions to sequence the
//! generation loop that used to live in Rust as
//! `budget_calc::smart_parse::SmartParseSession::run` -- separate wasm
//! module instances cannot call each other directly, only JS can
//! sequence calls across them, so that control flow had to move there.
//! Every actual calculation stays here, individually unit-tested in
//! `budget_calc::smart_parse_orchestrate`.
//!
//! No business logic lives here either -- the bindings parse buffers,
//! call into `budget-calc`, and return the result. See CLAUDE.md and
//! `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod orchestrate;

pub use orchestrate::*;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("orchestrate.rs", include_str!("orchestrate.rs"))];

    #[test]
    fn every_binding_serializes_through_the_json_compatible_helper() {
        let mut offenders = Vec::new();
        for (name, source) in BINDINGS {
            for (i, line) in source.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                if code.contains("serde_wasm_bindgen::to_value") {
                    offenders.push(format!("{name}:{}", i + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these lines serialize with serde_wasm_bindgen::to_value: {offenders:?}. \
             Use convert::to_js."
        );
    }

    #[test]
    fn no_binding_debug_formats_an_error_into_a_user_facing_field() {
        let mut offenders = Vec::new();
        for (name, source) in BINDINGS {
            for (i, line) in source.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                if code.contains("{e:?}") || code.contains("{err:?}") {
                    offenders.push(format!("{name}:{}", i + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these lines Debug-format an error that reaches the DOM: {offenders:?}. \
             Use Message instead."
        );
    }
}

/// Initialize the WASM module (sets up panic hook for better error messages).
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
