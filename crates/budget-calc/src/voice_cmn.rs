//! Mandarin speech-to-text via `wenet-aishell-u2pp-conformer` (the CTC
//! branch of a `WeNet` U2++ Conformer) -- see `voice_wenet.rs` for the
//! one forward pass all three languages now share.
//!
//! **Why this model and not `zh-citrinet-512`, which shipped first.**
//! Same reason as `voice.rs`: the `NeMo` model was re-hosted from
//! NVIDIA's NGC catalogue under terms that are not a permissive
//! open-source licence, and this app serves the file from its own
//! origin. `WeNet`'s pretrained models follow the licence of the corpus
//! they were trained on, and AISHELL-1 is published by Beijing Shell
//! Shell Technology Co., Ltd under **Apache License v.2.0**
//! (<https://www.openslr.org/33/>).
//!
//! **A caveat that belongs next to that claim, not buried in a
//! changelog:** the same openslr page's prose also says "The data is
//! free for academic use." The formal `License:` field is Apache-2.0,
//! which permits commercial use, and `WeNet`'s model-licence policy points
//! at exactly that field -- but the two sentences sit on one page and a
//! reader could take the second as a restriction. See `MODEL-LICENSES.md`,
//! which records both readings rather than picking the convenient one.
//!
//! Choosing the same architecture as the Cantonese model that shipped
//! first (since withdrawn, see `MODEL-LICENSES.md`) was deliberate: the fbank recipe, the two-input `x`/`x_lens` graph
//! shape, the blank-at-index-0 convention and the `▁` join rule all
//! carried over unchanged.
//!
//! One consequence of the corpus worth knowing before reading an
//! accuracy number: AISHELL-1 is 178 hours of read Mandarin, against the
//! ~1000 hours of AISHELL-2 behind Citrinet-512. Less data is a real
//! reason to expect a weaker model, so this swap was re-measured rather
//! than assumed -- see the accuracy note in `MODEL-LICENSES.md` and the
//! integration test in `tests/voice_models.rs`.

use std::sync::OnceLock;

use budget_core::BudgetError;

use crate::voice_wenet::{parse_tokens_txt, transcribe};

/// Read from the model's own shipped tokens file, whose first line is
/// `<blank> 0`. The `NeMo` model this replaced put blank *last* (5206),
/// so this is pinned per model and asserted below rather than assumed.
const BLANK_ID: usize = 0;

const TOKENS_TXT: &str = include_str!("../assets/voice/zh-wenet-tokens.txt");

fn vocab() -> &'static [String] {
    static VOCAB: OnceLock<Vec<String>> = OnceLock::new();
    VOCAB.get_or_init(|| parse_tokens_txt(TOKENS_TXT, "voice_cmn"))
}

/// Transcribes one spoken Mandarin command. `samples` is 16kHz mono
/// `f32` in `[-1.0, 1.0]`; `model_bytes` is the model's `.rten` file,
/// fetched by the host layer (no filesystem inside wasm).
///
/// Returns the raw, often-misheard transcript -- never the parsed
/// transaction.
pub fn transcribe_voice_command_cmn(
    model_bytes: Vec<u8>,
    samples: &[f32],
) -> Result<String, BudgetError> {
    transcribe(model_bytes, samples, vocab(), BLANK_ID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_audio_is_rejected_before_touching_the_model() {
        let err = transcribe_voice_command_cmn(vec![], &[]).unwrap_err();
        assert_eq!(err, BudgetError::EmptyAudio);
    }

    #[test]
    fn garbage_model_bytes_fail_to_load_rather_than_panicking() {
        let samples = vec![0.0f32; 1600];
        let err = transcribe_voice_command_cmn(b"not a model".to_vec(), &samples).unwrap_err();
        assert!(matches!(err, BudgetError::VoiceModelLoadFailed(_)));
    }

    #[test]
    fn the_tokens_file_parses_into_a_dense_vocab_with_blank_first() {
        let vocab = vocab();
        assert_eq!(vocab.len(), 4233);
        assert_eq!(vocab[BLANK_ID], "<blank>");
        assert_eq!(vocab[1], "<unk>");
        assert_eq!(vocab[4232], "<sos/eos>");
        assert!(vocab.iter().all(|t| !t.is_empty()));
    }

    /// Mostly single CJK characters, unlike English's word-pieces -- the
    /// join rule is shared regardless, which is the point of
    /// `voice_wenet.rs`, but the asset really is a different shape.
    #[test]
    fn the_vocabulary_is_predominantly_single_characters() {
        let single = vocab()
            .iter()
            .filter(|t| t.chars().count() == 1 && !t.starts_with('<'))
            .count();
        assert!(
            single > 3500,
            "expected a character vocab, found {single} single-char tokens"
        );
    }
}
