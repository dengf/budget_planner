//! Lazily-loaded WebAssembly bindings for Cantonese voice-to-transaction ASR.
//!
//! Its own crate for the same reason as `budget-wasm-voice`
//! (English)/`budget-wasm-voice-cmn` (Mandarin) rather than a third
//! message type inside either: every spoken language is mutually
//! exclusive per user action (one selected at a time), and the `WeNet`
//! Conformer's vocabulary/model bytes (360.9MB fp32) have no reason to
//! sit in an English- or Mandarin-only session's download, or vice versa
//! -- see `budget-calc`'s `voice-yue` feature and `budget-wasm-voice`'s
//! own doc comment for the fuller rationale, which applies here
//! unchanged.
//!
//! `www/src/voiceWorker.js` `import()`s this crate's own `pkg-voice-yue`
//! output only the first time someone selects Cantonese in the voice
//! language picker. `parse_voice_command` (already `VoiceLanguage`-aware
//! since PR1) stays in the main `budget-wasm` crate, not here -- same
//! reasoning as `budget-wasm-voice`'s doc comment: plain text matching,
//! no heavy dependency, no size reason to duplicate per language.
//!
//! No business logic lives in this crate either -- the one function here
//! parses bytes, calls into `budget-calc`, and serializes the result
//! back. See CLAUDE.md and `budget-wasm`'s own identical rule.

use wasm_bindgen::prelude::*;

pub mod convert;
pub mod dto;
pub mod voice;

pub use voice::transcribe_voice_command_yue;

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
