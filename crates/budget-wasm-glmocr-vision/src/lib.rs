//! Lazily-loaded WebAssembly bindings for GLM-OCR's vision encoder, one
//! of four independent wasm modules "Smart Parse" now spans (the others
//! are the sibling `budget-wasm-glmocr-embed`/`-decoder`/`-orchestrate`
//! crates) -- previously all three models lived in one shared
//! `budget-wasm-glmocr` module's wasm32 linear memory, which crashed
//! real phones by exceeding wasm32's hard 4GiB memory ceiling. Root
//! cause: `rten` doesn't support fp16 natively and eagerly converts
//! every weight tensor to a freshly-allocated f32 buffer at load time,
//! roughly doubling each model's resident memory over its on-disk fp16
//! size -- confirmed against `rten`'s own source, and against a real
//! iPhone `.ips` crash report showing a SIGSEGV in WebKit/JSC's GC,
//! triggered from a `memory.grow()` call landing exactly at the 4GiB
//! boundary. Giving each model its own wasm module instance (own linear
//! memory) means no single wasm32 address space ever needs to hold more
//! than one model's doubled footprint at once -- see
//! `budget_calc::smart_parse_model`'s own doc comment for the fuller
//! rationale, and `www/src/ocrWorker.js` for how the generation loop
//! that used to live in Rust now sequences calls across all four of
//! these modules from JS.
//!
//! No business logic lives here either -- the one binding parses
//! buffers, calls into `budget-calc`, and serializes the result back.
//! See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod vision;

pub use vision::VisionEncoder;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("vision.rs", include_str!("vision.rs"))];

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
