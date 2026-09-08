//! Lazily-loaded WebAssembly bindings for rasterizing a PDF page to pixels.
//!
//! A fourth independent lazy wasm module, alongside `budget-wasm-ocr`,
//! `budget-wasm-pdf` and `budget-wasm-glmocr` -- see this repo's own
//! CLAUDE.md for why each heavy, rarely-used capability gets its own
//! crate rather than growing one shared one. `hayro` (a pure-Rust PDF
//! interpreter/rasterizer) is only reachable from `budget-calc`'s
//! `pdf-render` feature, which only this crate enables, so a session that
//! never touches a PDF -- and a PDF session whose file already has a text
//! layer and doesn't need Smart Parse -- never downloads it.
//!
//! `www/src/ocrWorker.js` `import()`s this crate's own `pkg-pdfrender`
//! output only when a PDF page actually needs rasterizing: a scanned PDF
//! with no text layer, or any PDF page when Smart Parse is turned on
//! (Smart Parse's GLM-OCR reads pixels, not `pdf-extract`'s heuristic
//! text, on the theory that vision-based extraction is more accurate than
//! text-layer heuristics for the same reason it was worth adding for
//! photographed receipts in the first place).
//!
//! No business logic lives in this crate either -- `pdf_page_count` and
//! `render_pdf_page` parse bytes, call into `budget-calc`, and serialize
//! the result back. See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod pdf_render;

pub use pdf_render::{pdf_page_count, render_pdf_page};

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own binding file -- bindings split across crates
/// need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("pdf_render.rs", include_str!("pdf_render.rs"))];

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
