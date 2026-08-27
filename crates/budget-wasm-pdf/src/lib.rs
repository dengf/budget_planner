//! Lazily-loaded WebAssembly bindings for PDF receipt text extraction.
//!
//! Split out from `budget-wasm-ocr` (which used to hold both OCR and PDF
//! bindings together) because `pdf-extract`'s own dependency chain --
//! `lopdf`, `encoding_rs`, `miniz_oxide`, `sha2` -- was a real, measured
//! fraction of that crate's size (a single ~625KB data segment, roughly a
//! fifth of the combined binary, traced via `twiggy top` to glyph-name
//! and text-encoding tables) despite being irrelevant to OCR. A photo
//! scan and a PDF upload are independent user paths that never both run
//! in one session, so bundling them meant every photo scan paid for PDF
//! parsing it never used, and vice versa. `budget-calc`'s `pdf-text`
//! feature (which this crate is the only one to enable) keeps
//! `pdf-extract` out of both `budget-wasm` and `budget-wasm-ocr`'s
//! dependency graphs entirely, not just unreached at runtime.
//!
//! `www/src/receiptCapture.js` `import()`s this crate's own `pkg-pdf`
//! output only the first time someone uploads a PDF, so a photo-only
//! session never downloads it.
//!
//! No business logic lives in this crate either -- the one function
//! parses bytes, calls into `budget-calc`, and serializes the result
//! back. See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod pdf_text;

pub use pdf_text::extract_pdf_text;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("pdf_text.rs", include_str!("pdf_text.rs"))];

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
