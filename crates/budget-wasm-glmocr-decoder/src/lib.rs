//! Lazily-loaded WebAssembly bindings for GLM-OCR's decoder, one of four
//! independent wasm modules "Smart Parse" now spans (the others are the
//! sibling `budget-wasm-glmocr-vision`/`-embed`/`-orchestrate` crates) --
//! see `budget-wasm-glmocr-vision`'s own doc comment for the full
//! 4GiB-ceiling/fp16-doubling rationale behind the split.
//!
//! Unlike its vision/embed siblings, this module's session is
//! **stateful across calls**: `DecoderSession` holds the KV cache
//! (`past_key_values`) internally, growing every greedy-decode step, and
//! it deliberately never crosses the wasm boundary -- see
//! `budget_calc::smart_parse_model::DecoderSession`'s own doc comment.
//! **Every caller must call `reset()` before the first `step()` of a new
//! image's generation** -- skipping it silently splices a new scan's
//! tokens onto a previous scan's cached keys/values (wrong output, not a
//! crash), so nothing else catches the mistake if it's made.
//!
//! No business logic lives here either -- the one binding parses
//! buffers, calls into `budget-calc`, and serializes the result back.
//! See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod decoder;
pub mod dto;

pub use decoder::DecoderSession;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("decoder.rs", include_str!("decoder.rs"))];

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
