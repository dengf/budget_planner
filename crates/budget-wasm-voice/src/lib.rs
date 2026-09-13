//! Lazily-loaded WebAssembly bindings for voice-to-transaction ASR.
//!
//! Split out from `budget-wasm` for the same reason as
//! `budget-wasm-ocr`/`budget-wasm-pdf`/`budget-wasm-llm`/
//! `budget-wasm-pdfrender`: the CTC ASR model this binds (QuartzNet15x5,
//! fp32 -- see `voice.rs`'s own doc comment in `budget-calc` for why fp32
//! and why this architecture) plus `rten-embed`/`rten-tensor`/`rustfft`
//! would otherwise sit in every session's always-loaded download even
//! though most budgeting sessions never open the voice tab.
//! `budget-calc`'s `voice` feature (which this crate is the only one to
//! enable) keeps that dependency graph out of `budget-wasm` entirely, not
//! just unreached at runtime -- see that feature's own doc comment.
//!
//! `www/src/voiceWorker.js` `import()`s this crate's own `pkg-voice`
//! output only the first time someone opens the voice-entry UI, so
//! everyday budgeting never downloads it. The grammar/category-matching
//! step that turns a transcript into a draft (`parse_voice_command`) is a
//! *separate* binding in the main `budget-wasm` crate, not here -- it's
//! plain text matching with no heavy dependency, so it has no size reason
//! to live in this lazy module.
//!
//! No business logic lives in this crate either -- the one function here
//! parses bytes, calls into `budget-calc`, and serializes the result
//! back. See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod voice;

pub use voice::transcribe_voice_command;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("voice.rs", include_str!("voice.rs"))];

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
