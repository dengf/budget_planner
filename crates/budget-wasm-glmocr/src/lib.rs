//! Lazily-loaded WebAssembly bindings for "Smart Parse" -- GLM-OCR, a
//! 0.9B vision-language model, read over a photographed receipt or
//! statement instead of the always-available `budget-wasm-ocr` engine.
//!
//! A *fourth* independent lazy wasm module, not a mode of
//! `budget-wasm-ocr` -- see `budget-calc::smart_parse`'s own doc comment
//! for why this is a second OCR engine, and `www/src/ocrWorker.js` for
//! why its ~2.2GB of model weights are fetched from Hugging Face at
//! runtime rather than vendored the way `budget-wasm-ocr`'s ~6.3MB
//! PP-OCRv6_tiny models are. Every ordinary budgeting session, and even
//! an ordinary "Take a photo" receipt scan, downloads none of this --
//! only a user who explicitly opts into Smart Parse ever triggers
//! `www/src/receiptCapture.js`'s `import('../pkg-glmocr')`.
//!
//! No business logic lives in this crate either -- the one binding
//! parses buffers, calls into `budget-calc`, and serializes the result
//! back. See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod smart_parse;

pub use smart_parse::SmartParseSession;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("smart_parse.rs", include_str!("smart_parse.rs"))];

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
