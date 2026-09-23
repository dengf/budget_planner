//! The one `WeNet` U2++ Conformer (CTC branch) forward pass, shared by both
//! voice models.
//!
//! This module exists because the languages stopped being separate
//! architectures. Cantonese (since withdrawn over its corpus licence, see
//! `MODEL-LICENSES.md`) arrived as a `WeNet` Conformer while English was
//! `NeMo` `QuartzNet15x5` and Mandarin `NeMo` Citrinet-512, so a `NeMo`
//! log-mel recipe and `voice_fbank.rs` (the Kaldi-style one `WeNet` needs)
//! each had callers.
//!
//! Replacing the two `NeMo` models -- both re-hosted under NVIDIA's NGC
//! terms rather than a permissive licence -- with their `WeNet`
//! equivalents left every shipped model on one architecture, one DSP and
//! one decode rule, and the log-mel module with no caller at all. A copy
//! per language would be as many things to keep in step, so there is
//! one, here, and each language module is now just a tokens file plus a
//! doc comment recording what was measured for it.
//!
//! What is common to both exports, each confirmed by inspecting the
//! compiled `.rten` graph rather than assumed from the architecture name:
//!
//! - **Two inputs, `x` and `x_lens`.** `x` is `[N, T, 80]` -- batch,
//!   time, mel-bins -- which is the opposite axis order from the `NeMo`
//!   family's `[1, n_mels, n_frames]` `audio_signal`. Getting either
//!   wrong does not produce a bad transcript, it fails the forward pass;
//!   `voice_cmn.rs` shipping without its `length` input is the
//!   cautionary case.
//! - **Two outputs**, and the one wanted is `log_probs` by name. Nothing
//!   guarantees graph export order, so every node here is looked up by
//!   name and never by `input_ids().first()`.
//! - **Blank is index 0**, read from each model's own shipped tokens file
//!   (both begin `<blank> 0`). The `NeMo` models these replace both
//!   put blank *last*, so this is pinned per model in its own module and
//!   asserted by a test there -- getting it wrong yields confident
//!   nonsense, not an error.
//! - **The same Kaldi fbank recipe** (`voice_fbank::wenet_mel_filterbank`,
//!   80 bins), and the same join rule: concatenate the tokens, turn the
//!   `▁` word-boundary marker into a space, trim. That rule was worked
//!   out for Cantonese against real spliced Cantonese+English audio and
//!   is not a CJK/ASCII heuristic -- it is simply how a `WeNet`
//!   `SentencePiece` vocabulary spells word boundaries, so it is correct
//!   for the Latin-script vocabulary too.

use rten_embed::Model;
use rten_tensor::Tensor;

use budget_core::BudgetError;

use crate::voice_fbank::{fbank_features, wenet_mel_filterbank};

/// Every `WeNet` export here is 80-bin fbank.
pub(crate) const N_MELS: usize = 80;

/// Parses a `WeNet` `token<space>id` tokens file (one per line, dense
/// `0..=max_id`) into a `Vec<String>` indexed by id.
///
/// Panics on a malformed line: these files are checked-in build assets
/// pinned to one exact model export, not user input, so a parse failure
/// means the asset itself is wrong and should fail loudly at first use
/// rather than be silently tolerated. `which` names the calling module so
/// the panic says which one is broken.
pub(crate) fn parse_tokens_txt(text: &str, which: &str) -> Vec<String> {
    let mut vocab: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let (token, id_str) = line
            .rsplit_once(' ')
            .unwrap_or_else(|| panic!("{which} tokens file: line missing a token/id separator"));
        let id: usize = id_str
            .parse()
            .unwrap_or_else(|_| panic!("{which} tokens file: id is not a number"));
        if id >= vocab.len() {
            vocab.resize(id + 1, String::new());
        }
        vocab[id] = token.to_string();
    }
    vocab
}

/// Greedy CTC decode: argmax per frame, collapse immediate repeats, drop
/// the blank. Pure and model-independent (index-only, no label lookup),
/// so it is tested without ever loading a model and is shared by every
/// model on this pipeline regardless of vocabulary size or blank position.
pub(crate) fn ctc_greedy_decode_indices(logits: &Tensor<f32>, blank: usize) -> Vec<usize> {
    use rten_tensor::prelude::*;
    let frames = logits.shape()[1];
    let classes = logits.shape()[2];
    let mut indices = Vec::new();
    let mut prev = usize::MAX;
    for f in 0..frames {
        let mut best = 0usize;
        let mut best_v = f32::MIN;
        for c in 0..classes {
            let v = logits[[0, f, c]];
            if v > best_v {
                best_v = v;
                best = c;
            }
        }
        if best != prev && best != blank {
            indices.push(best);
        }
        prev = best;
    }
    indices
}

/// Collapses CTC repeats, drops `blank_id`, then joins with the `▁`
/// word-boundary rule described in this module's doc comment.
pub(crate) fn ctc_greedy_decode(logits: &Tensor<f32>, vocab: &[String], blank_id: usize) -> String {
    let text: String = ctc_greedy_decode_indices(logits, blank_id)
        .into_iter()
        .map(|i| vocab[i].as_str())
        .collect();
    text.replace('▁', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 300ms of silence, at 16kHz.
const LEAD_IN_SAMPLES: usize = 300 * 16;

/// Pads the clip with silence at both ends before feature extraction.
///
/// These are U2++ Conformers: every frame attends over the whole
/// utterance, and the conv subsampling front-end needs a few frames of
/// context before its receptive field is full. A clip that starts on the
/// first phoneme gives it neither, and the first word comes out mangled
/// in a way the rest of the transcript does not share -- "add expense"
/// decoded as "HADPEN", "ANDPENS", "AT EXPENSE".
///
/// Measured on the 50-clip English corpus (`tests/voice_models.rs`):
/// 60% of commands parsed into the right transaction without this, 88%
/// with it. Mandarin, 60% to 68%. That is not a tuning knob, it is the
/// difference between a usable feature and an unusable one, so it lives
/// in the pipeline rather than in whatever the caller happens to hand
/// over. Trailing silence costs the same and is symmetric; 300ms is
/// ~30 frames, about 7 after subsampling, and adds under 10ms to a
/// forward pass that takes ~200ms.
///
/// This is not a substitute for a real recording's lead-in -- it is
/// insurance for the case where there is none, which is exactly what
/// someone who taps the mic button and starts talking produces.
fn with_lead_in_silence(samples: &[f32]) -> Vec<f32> {
    let mut padded = Vec::with_capacity(samples.len() + 2 * LEAD_IN_SAMPLES);
    padded.resize(LEAD_IN_SAMPLES, 0.0);
    padded.extend_from_slice(samples);
    padded.resize(padded.len() + LEAD_IN_SAMPLES, 0.0);
    padded
}

/// Runs one `WeNet` CTC forward pass and returns the raw transcript.
///
/// `samples` is 16kHz mono `f32` in `[-1.0, 1.0]`; `model_bytes` is the
/// model's `.rten` file, fetched by the host layer (no filesystem inside
/// wasm). Returns the raw, often-misheard transcript -- never the parsed
/// transaction. See `voice_parse::parse_voice_command`, where the
/// accuracy that actually matters is won by constrained matching against
/// a closed category vocabulary.
pub(crate) fn transcribe(
    model_bytes: Vec<u8>,
    samples: &[f32],
    vocab: &[String],
    blank_id: usize,
) -> Result<String, BudgetError> {
    if samples.is_empty() {
        return Err(BudgetError::EmptyAudio);
    }

    let model =
        Model::load(model_bytes).map_err(|e| BudgetError::VoiceModelLoadFailed(e.to_string()))?;
    // By name, never by position -- see this module's doc comment.
    let audio_input_id = model
        .find_node("x")
        .ok_or_else(|| BudgetError::VoiceModelLoadFailed("model has no x input".into()))?;
    let lens_input_id = model
        .find_node("x_lens")
        .ok_or_else(|| BudgetError::VoiceModelLoadFailed("model has no x_lens input".into()))?;
    let output_id = model
        .find_node("log_probs")
        .ok_or_else(|| BudgetError::VoiceModelLoadFailed("model has no log_probs output".into()))?;

    let filterbank = wenet_mel_filterbank(N_MELS);
    let padded = with_lead_in_silence(samples);
    let (features, n_mels, n_frames) = fbank_features(&padded, &filterbank, N_MELS);
    // `[1, n_frames, n_mels]` -- time-major, see the doc comment.
    let input = Tensor::from_data(&[1, n_frames, n_mels], features);
    let lens = Tensor::from_data(&[1], vec![n_frames as i32]);

    let [output] = model
        .run_n(
            vec![(audio_input_id, input.into()), (lens_input_id, lens.into())],
            [output_id],
            None,
        )
        .map_err(|e| BudgetError::VoiceTranscribeFailed(e.to_string()))?;
    let logits: Tensor<f32> = output
        .try_into()
        .map_err(|_| BudgetError::VoiceTranscribeFailed("unexpected output shape".into()))?;

    Ok(ctc_greedy_decode(&logits, vocab, blank_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab_of(pairs: &[(&str, usize)]) -> Vec<String> {
        let mut v = vec![String::new(); pairs.iter().map(|p| p.1).max().unwrap() + 1];
        for (t, i) in pairs {
            v[*i] = (*t).to_string();
        }
        v
    }

    #[test]
    fn the_word_marker_becomes_a_space_and_bare_pieces_join_up() {
        let vocab = vocab_of(&[("<blank>", 0), ("▁THE", 1), ("▁CA", 2), ("T", 3)]);
        let classes = vocab.len();
        let frames = 3;
        let mut data = vec![-10.0f32; frames * classes];
        data[1] = 10.0;
        data[classes + 2] = 10.0;
        data[2 * classes + 3] = 10.0;
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode(&logits, &vocab, 0), "THE CAT");
    }

    #[test]
    fn repeats_collapse_and_blank_resets_the_repeat_guard() {
        let vocab = vocab_of(&[("<blank>", 0), ("A", 1)]);
        let classes = vocab.len();
        let frames = 4;
        let mut data = vec![-10.0f32; frames * classes];
        data[1] = 10.0; // A
        data[classes + 1] = 10.0; // A -- collapsed
        data[2 * classes] = 10.0; // blank
        data[3 * classes + 1] = 10.0; // A -- kept, a blank came between
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode(&logits, &vocab, 0), "AA");
    }

    #[test]
    fn a_dense_tokens_file_parses_by_id_not_by_line_order() {
        // Deliberately out of order, and with a token containing no space.
        let vocab = parse_tokens_txt("b 1\n<blank> 0\nc 2\n", "test");
        assert_eq!(vocab, vec!["<blank>", "b", "c"]);
    }

    #[test]
    fn ctc_decode_indices_collapses_repeats_and_drops_the_blank() {
        let classes = 5;
        let frames = 5;
        let blank = 4;
        let mut data = vec![-10.0f32; frames * classes];
        let mut set = |f: usize, c: usize| data[f * classes + c] = 10.0;
        set(0, 1);
        set(1, 2);
        set(2, 2); // repeat -- collapsed to one
        set(3, blank); // resets the repeat guard
        set(4, 2); // not collapsed with frame 1/2: a blank came between
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(
            ctc_greedy_decode_indices(&logits, blank),
            vec![1usize, 2, 2]
        );
    }

    #[test]
    fn ctc_decode_indices_of_all_blank_is_empty() {
        let classes = 3;
        let frames = 3;
        let blank = 0;
        let mut data = vec![-10.0f32; frames * classes];
        for f in 0..frames {
            data[f * classes + blank] = 10.0;
        }
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert!(ctc_greedy_decode_indices(&logits, blank).is_empty());
    }

    #[test]
    fn ctc_decode_indices_handles_a_blank_that_is_not_zero_or_last() {
        // Blank position varies by model (QuartzNet: last; WeNet Conformer:
        // first) -- this test pins a value in between to prove the function
        // takes `blank` as real input rather than assuming an endpoint.
        let classes = 5;
        let frames = 2;
        let blank = 2;
        let mut data = vec![-10.0f32; frames * classes];
        data[blank] = 10.0; // frame 0
        data[classes + 3] = 10.0; // frame 1
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode_indices(&logits, blank), vec![3usize]);
    }

    #[test]
    fn silence_is_added_at_both_ends_and_the_clip_survives_intact() {
        let clip = vec![0.5f32; 100];
        let padded = with_lead_in_silence(&clip);
        assert_eq!(padded.len(), 100 + 2 * LEAD_IN_SAMPLES);
        assert!(padded[..LEAD_IN_SAMPLES].iter().all(|&s| s == 0.0));
        assert!(padded[LEAD_IN_SAMPLES + 100..].iter().all(|&s| s == 0.0));
        assert_eq!(&padded[LEAD_IN_SAMPLES..LEAD_IN_SAMPLES + 100], &clip[..]);
    }

    #[test]
    fn empty_audio_is_rejected_before_touching_the_model() {
        let err = transcribe(vec![], &[], &[String::new()], 0).unwrap_err();
        assert_eq!(err, BudgetError::EmptyAudio);
    }

    #[test]
    fn garbage_model_bytes_fail_to_load_rather_than_panicking() {
        let samples = vec![0.0f32; 1600];
        let err = transcribe(b"not a model".to_vec(), &samples, &[String::new()], 0).unwrap_err();
        assert!(matches!(err, BudgetError::VoiceModelLoadFailed(_)));
    }
}
