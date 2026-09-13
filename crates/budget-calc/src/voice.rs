//! Speech-to-text for voice-entered transactions, using `QuartzNet15x5` (a
//! CTC acoustic model) via `rten` -- one forward pass over precomputed
//! log-mel features, no autoregressive decode loop.
//!
//! A generative/autoregressive model (Whisper, any KV-cached decoder) was
//! tried first in a throwaway spike and rejected on the same grounds as
//! the GLM-OCR VLM this app already pulled: multi-hundred-MB to GB scale,
//! fragile on real phones, not the shape that has worked here (`ocr.rs`'s
//! `PP-OCRv6_tiny` and `embed_classify.rs`'s `MiniLM` are both single-forward-
//! pass). `QuartzNet15x5` (72MB fp32) was the smallest CTC model measured
//! that stayed above 90% *parsed-transaction* accuracy -- not word-error
//! rate, which stayed poor (single digits) even on much larger models.
//! `voice_parse.rs`'s constrained matching against a closed category
//! vocabulary is what makes a noisy transcript usable; this module's job
//! is only to produce that noisy transcript as fast as possible.
//!
//! `rten`'s int8 quantized export of a much larger model (Citrinet-512,
//! same architecture family) was measured and rejected: it ran at full
//! speed and returned confidently empty transcripts on every input,
//! verified against an fp32 control that scored 100% on the identical
//! features. int8 through this rten version is not safe to ship -- fp32
//! is the real size floor, not the size anyone would prefer.
//!
//! Model and audio bytes arrive as plain buffers, no filesystem inside
//! wasm -- same reasoning as `ocr.rs` and `embed_classify.rs`.
//!
//! The log-mel feature extraction and the index-level CTC decode are
//! shared with Mandarin's Citrinet-512 (`voice_cmn.rs`, same `NeMo`
//! architecture family, same DSP, just a different mel-bin count and
//! vocabulary) via `voice_mel.rs` -- see that module's own doc comment.

// `rten_embed` is this crate's Cargo.toml alias for a *second*, 0.26.0
// pin of the plain `rten` crate -- reused from `embed_classify.rs` rather
// than adding a third pin, since both are single-forward-pass models on
// the same runtime. See that Cargo.toml feature's own doc comment.
use rten_embed::Model;
use rten_tensor::Tensor;

use budget_core::BudgetError;

use crate::voice_mel::{ctc_greedy_decode_indices, log_mel_features, mel_filterbank};

const N_MELS: usize = 64;

/// `QuartzNet15x5`'s own label set: index 0 is the word separator, 28 is
/// the CTC blank -- note the blank is *last* here, unlike some CTC
/// models (wav2vec2, spiked and rejected above) that put it first.
/// Getting this wrong produces confident nonsense, not an error, so it
/// is pinned to this exact model rather than read from a config file
/// that could drift.
const QUARTZNET_BLANK: usize = 28;

fn quartznet_label(index: usize) -> &'static str {
    const LABELS: [&str; 29] = [
        " ", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q",
        "r", "s", "t", "u", "v", "w", "x", "y", "z", "'", "",
    ];
    LABELS[index]
}

fn ctc_greedy_decode(logits: &Tensor<f32>) -> String {
    let text: String = ctc_greedy_decode_indices(logits, QUARTZNET_BLANK)
        .into_iter()
        .map(quartznet_label)
        .collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Transcribes one spoken command. `samples` is 16kHz mono `f32` in
/// `[-1.0, 1.0]`; `model_bytes` is `QuartzNet15x5`'s `.rten` file, fetched
/// by the host layer (no filesystem inside wasm).
///
/// Returns the raw, often-misheard transcript -- never the parsed
/// transaction. See `voice_parse::parse_voice_command`, the always-
/// loaded module that turns this into a draft: the accuracy that matters
/// (parsed transaction, not word error rate) lives entirely in that
/// constrained match, not here.
pub fn transcribe_voice_command(
    model_bytes: Vec<u8>,
    samples: &[f32],
) -> Result<String, BudgetError> {
    if samples.is_empty() {
        return Err(BudgetError::EmptyAudio);
    }

    let model =
        Model::load(model_bytes).map_err(|e| BudgetError::VoiceModelLoadFailed(e.to_string()))?;
    let input_id = *model
        .input_ids()
        .first()
        .ok_or_else(|| BudgetError::VoiceModelLoadFailed("model has no input".into()))?;
    let output_id = *model
        .output_ids()
        .first()
        .ok_or_else(|| BudgetError::VoiceModelLoadFailed("model has no output".into()))?;

    let filterbank = mel_filterbank(N_MELS);
    let (features, n_mels, n_frames) = log_mel_features(samples, &filterbank, N_MELS);
    let input = Tensor::from_data(&[1, n_mels, n_frames], features);

    let [output] = model
        .run_n(vec![(input_id, input.into())], [output_id], None)
        .map_err(|e| BudgetError::VoiceTranscribeFailed(e.to_string()))?;
    let logits: Tensor<f32> = output
        .try_into()
        .map_err(|_| BudgetError::VoiceTranscribeFailed("unexpected output shape".into()))?;

    Ok(ctc_greedy_decode(&logits))
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
    fn ctc_decode_collapses_repeats_and_drops_the_blank() {
        // logits: [1, 4, 29], each frame's argmax hand-picked.
        // Frame 0: 'h' (7... wait, use real indices) -- see LABELS above:
        // index 8='h', 5='e', repeated, then blank, then 12='l'.
        let classes = 29;
        let frames = 5;
        let mut data = vec![-10.0f32; frames * classes];
        let mut set = |f: usize, c: usize| data[f * classes + c] = 10.0;
        set(0, 8); // h
        set(1, 5); // e
        set(2, 5); // e (repeat -- collapsed to one)
        set(3, QUARTZNET_BLANK); // blank -- resets the repeat guard
        set(4, 5); // e (not collapsed with frame 1/2: a blank came between)
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode(&logits), "hee");
    }

    #[test]
    fn ctc_decode_of_all_blank_is_empty() {
        let classes = 29;
        let frames = 3;
        let mut data = vec![-10.0f32; frames * classes];
        for f in 0..frames {
            data[f * classes + QUARTZNET_BLANK] = 10.0;
        }
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode(&logits), "");
    }
}
