//! English speech-to-text via `wenet-librispeech-u2pp-conformer` (the
//! CTC branch of a `WeNet` U2++ Conformer) -- see `voice_wenet.rs` for
//! the one forward pass all three languages now share, and
//! `voice_fbank.rs` for the Kaldi-style fbank DSP it needs.
//!
//! **Why this model and not `QuartzNet15x5`, which shipped first.** The
//! `NeMo` models were re-hosted from NVIDIA's NGC catalogue, whose terms
//! are not a permissive open-source licence -- this app serves the model
//! file from its own origin, which is redistribution, so "it's free to
//! download" was never the question. `WeNet`'s pretrained models
//! follow the licence of the corpus they were trained on
//! (<https://github.com/wenet-e2e/wenet/blob/main/docs/pretrained_models.md>:
//! "The pretrained model in `WeNet` follows the license of it's
//! corresponding dataset"), and `LibriSpeech` is **CC BY 4.0**. That is a
//! licence this project can actually satisfy, and `MODEL-LICENSES.md`
//! carries the attribution and statement of modification it requires.
//!
//! Choosing the same architecture as the Cantonese model that shipped
//! first (since withdrawn, see `MODEL-LICENSES.md`) was deliberate: the fbank recipe, the two-input `x`/`x_lens` graph
//! shape, the blank-at-index-0 convention and the `▁` join rule all
//! carried over unchanged, so this swap moved weights and a tokens file
//! rather than introducing a fourth DSP path.
//!
//! What matters here is *parsed-transaction* accuracy, not word error
//! rate -- `voice_parse.rs`'s constrained matching against a closed
//! category vocabulary is what turns a noisy transcript into a usable
//! draft. This module's job is only to produce that transcript.
//!
//! `rten`'s int8 quantized export was measured and rejected during the
//! `QuartzNet15x5` work and that finding still stands: it ran at full
//! speed and returned confidently empty transcripts on every input,
//! verified against an fp32 control that scored 100% on the identical
//! features. int8 through this `rten` version is not safe to ship.
//!
//! f16 is not the same bet and was taken: it stores the weights at half
//! precision and `rten` widens them back to f32 at load, so it halves
//! the download without changing what any operator computes. Measured
//! the same way -- all 96 corpus transcripts came back byte-identical
//! to the f32 model's.

use std::sync::OnceLock;

use budget_core::BudgetError;

use crate::voice_wenet::{parse_tokens_txt, transcribe};

/// Read from the model's own shipped tokens file, whose first line is
/// `<blank> 0`. The `NeMo` model this replaced put blank *last* (28), so
/// this is pinned per model and asserted below rather than assumed.
const BLANK_ID: usize = 0;

const TOKENS_TXT: &str = include_str!("../assets/voice/en-wenet-tokens.txt");

fn vocab() -> &'static [String] {
    static VOCAB: OnceLock<Vec<String>> = OnceLock::new();
    VOCAB.get_or_init(|| parse_tokens_txt(TOKENS_TXT, "voice"))
}

/// Transcribes one spoken English command. `samples` is 16kHz mono `f32`
/// in `[-1.0, 1.0]`; `model_bytes` is the model's `.rten` file, fetched
/// by the host layer (no filesystem inside wasm).
///
/// Returns the raw, often-misheard transcript -- never the parsed
/// transaction.
pub fn transcribe_voice_command(
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
        let err = transcribe_voice_command(vec![], &[]).unwrap_err();
        assert_eq!(err, BudgetError::EmptyAudio);
    }

    #[test]
    fn garbage_model_bytes_fail_to_load_rather_than_panicking() {
        let samples = vec![0.0f32; 1600];
        let err = transcribe_voice_command(b"not a model".to_vec(), &samples).unwrap_err();
        assert!(matches!(err, BudgetError::VoiceModelLoadFailed(_)));
    }

    #[test]
    fn the_tokens_file_parses_into_a_dense_vocab_with_blank_first() {
        let vocab = vocab();
        assert_eq!(vocab.len(), 5002);
        assert_eq!(vocab[BLANK_ID], "<blank>");
        assert_eq!(vocab[1], "<unk>");
        assert_eq!(vocab[5001], "<sos/eos>");
        assert!(vocab.iter().all(|t| !t.is_empty()));
    }

    /// The vocabulary is `SentencePiece` word-pieces, not the 29 characters
    /// `QuartzNet15x5` used -- so a transcript is assembled from pieces
    /// carrying `▁`, and this pins that the asset really is that shape.
    #[test]
    fn the_vocabulary_is_word_pieces_carrying_the_boundary_marker() {
        let marked = vocab().iter().filter(|t| t.starts_with('▁')).count();
        assert!(
            marked > 1000,
            "expected a SentencePiece vocab, found {marked} marked pieces"
        );
    }
}
