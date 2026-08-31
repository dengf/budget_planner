//! Lazily-loaded WebAssembly bindings for receipt OCR over a
//! photographed receipt.
//!
//! Split out from `budget-wasm` because `ocrs-cjk`/`rten` (a full ML tensor
//! runtime -- matrix multiply, SIMD, ONNX model loading, `rayon`) were
//! most of that crate's wasm payload: ~1.9MB with them compiled in
//! (measured after the `ocrs` -> `ocrs-cjk` swap; the original `ocrs` was
//! 3.7MB), versus ~700KB for `budget-wasm` alone once they moved here -- paid on
//! every page load even though most sessions never open "Take a photo".
//! `budget-calc`'s `ocr` feature (which this crate is the only one to
//! enable) keeps `ocrs-cjk`/`rten` out of `budget-wasm`'s dependency graph
//! entirely, not just unreached at runtime -- see that feature's own doc
//! comment.
//!
//! PDF text extraction is a *separate* lazy module, `budget-wasm-pdf`,
//! not this one -- a photo scan and a PDF upload are independent user
//! paths that never both run, and `pdf-extract`'s own dependency chain
//! (`lopdf`, `encoding_rs`, `miniz_oxide`, `sha2`) was a real, measured
//! fraction of this crate's size despite being irrelevant to OCR. See
//! `budget-wasm-pdf/src/lib.rs`'s own doc comment.
//!
//! `www/src/receiptCapture.js` `import()`s this crate's own `pkg-ocr`
//! output only the first time someone opens the receipt-capture UI, so
//! everyday budgeting never downloads it.
//!
//! No business logic lives in this crate either -- every function parses
//! bytes, calls into `budget-calc`, and serializes the result back. See
//! CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod ocr;

pub use ocr::run_ocr;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("ocr.rs", include_str!("ocr.rs"))];

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
