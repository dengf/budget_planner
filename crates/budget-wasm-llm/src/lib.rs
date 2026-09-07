//! Lazily-loaded WebAssembly bindings for statement-row income/expense
//! classification.
//!
//! A third lazy wasm crate alongside `budget-wasm-ocr`/`budget-wasm-pdf`,
//! for the same reason those two are split from `budget-wasm` and from
//! each other: a BERT-family embedding model (`rten`/`rten-tensor`/
//! `rten-text`, ~23MB of model weights fetched at runtime, never compiled
//! into the wasm binary) is real weight that most statement imports never
//! need -- only rows where `budget_calc::receipt::resolve_statement_amount`
//! had no explicit sign, no `CR`/`DB` marker and no keyword to go on.
//! `budget_calc`'s `embed-classify` feature (which this crate is the only
//! one to enable) keeps that dependency out of `budget-wasm`,
//! `budget-wasm-ocr` and `budget-wasm-pdf`'s dependency graphs entirely.
//!
//! `www/src/ocrWorker.js` `import()`s this crate's own `pkg-llm` output
//! only when `parse_statement_text` actually returned a row with
//! `direction_is_guessed: true` -- most statements (explicit signs or
//! `CR`/`DB` markers throughout) never trigger it.
//!
//! No business logic lives in this crate either -- the one function
//! takes model bytes, tokenizer bytes and a batch of descriptions,
//! calls into `budget-calc`, and serializes the result back. See
//! CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod classify;
pub mod convert;
pub mod dto;

pub use classify::classify_statement_rows;

/// Same guard as `budget-wasm::message::no_debug_formatted_errors`, run
/// over this crate's own single binding file -- bindings split across
/// crates need the check applied per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[("classify.rs", include_str!("classify.rs"))];

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
