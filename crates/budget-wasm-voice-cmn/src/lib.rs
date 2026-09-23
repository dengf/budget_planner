//! Lazily-loaded WebAssembly bindings for Mandarin voice-to-transaction ASR.
//!
//! Its own crate for the same reason as `budget-wasm-voice`
//! (English) rather than a second message type inside that crate: the
//! two spoken languages are mutually exclusive per user action (one
//! language selected at a time), and the Mandarin model's vocabulary and
//! bytes (68.9MB, f16 weights) have no reason to sit in an English-only
//! session's download, or vice versa -- see `budget-calc`'s `voice-cmn`
//! feature and `budget-wasm-voice`'s own doc comment for the fuller
//! rationale, which applies here unchanged.
//!
//! `www/src/voiceWorker.js` `import()`s this crate's own `pkg-voice-cmn`
//! output only the first time someone selects Mandarin in the voice
//! language picker. `parse_voice_command` (now `VoiceLanguage`-aware)
//! stays in the main `budget-wasm` crate, not here -- same reasoning as
//! `budget-wasm-voice`'s doc comment: plain text matching, no heavy
//! dependency, no size reason to duplicate per language.
//!
//! No business logic lives in this crate either -- the one function here
//! parses bytes, calls into `budget-calc`, and serializes the result
//! back. See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod voice;

pub use voice::transcribe_voice_command_cmn;

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
