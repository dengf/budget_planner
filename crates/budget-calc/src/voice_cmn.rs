//! Mandarin speech-to-text via `zh-citrinet-512` (`NeMo` Citrinet-512, the
//! same single-forward-pass CTC architecture family as `voice.rs`'s
//! `QuartzNet15x5`) -- see `voice_mel.rs` for the shared log-mel DSP and
//! index-level CTC decode this module reuses unchanged.
//!
//! Measured in the spike that preceded this module: 96% exact-transcript,
//! 0.5% character-error-rate on 25 TTS-generated test utterances. The one
//! recorded miss was a real, plausible ASR mistake -- 买 ("buy") heard as
//! 卖 ("sell"), a near-homophone pair differing only in tone -- not a
//! structural failure, so the same "constrained matching over a smaller
//! model" philosophy as `voice.rs`/`voice_parse.rs` applies here too.
//!
//! Differs from `QuartzNet15x5` only in mel-bin count (80, not 64) and
//! vocabulary (a much larger, mostly-single-character vocabulary plus a
//! `▁` word-boundary marker, confirmed against the model's own shipped
//! tokens file rather than assumed) -- not in the DSP itself, which is
//! bit-for-bit the same recipe.
//!
//! **Unlike `QuartzNet15x5`, this model's compiled graph has a second
//! required input, `length`** (`int32`, the real frame count before
//! `voice_mel.rs`'s multiple-of-16 padding) -- confirmed by inspecting the
//! model's own input nodes directly, not assumed from `voice.rs`'s
//! single-input shape. Citrinet's masked convolutions use it to know
//! which trailing frames are padding rather than real audio; omitting it
//! doesn't produce a wrong transcript, it fails the whole forward pass
//! with an `rten` graph-planning error (`Missing input "length" for op
//! .../mconv.3/Shape_1`) -- a real bug that shipped to production in this
//! module's first version because no test here ever ran the real model
//! end-to-end, only the decode logic against synthetic tensors.

use rten_embed::Model;
use rten_tensor::Tensor;
use std::sync::OnceLock;

use budget_core::BudgetError;

use crate::voice_mel::{ctc_greedy_decode_indices, log_mel_features, mel_filterbank};

const N_MELS: usize = 80;

/// Confirmed by reading the model's own shipped tokens file: index 0 is
/// the SentencePiece-style `▁` word-boundary marker, `<blk>` (the CTC
/// blank) is last at 5206 -- same "blank last" convention as
/// `QuartzNet15x5`, but pinned independently since nothing about that is
/// guaranteed to hold for a different model's export.
const BLANK_ID: usize = 5206;

const TOKENS_TXT: &str = include_str!("../assets/voice/zh-citrinet-512-tokens.txt");

/// Parses the model's own `token<space>id` tokens file (one per line,
/// dense `0..=max_id`) into a `Vec<String>` indexed by id. Panics on a
/// malformed line -- this file is a checked-in build asset pinned to one
/// exact model export, not user input, so a parse failure here means the
/// asset itself is wrong and should fail loudly at first use, not be
/// silently tolerated.
fn parse_tokens_txt(text: &str) -> Vec<String> {
    let mut vocab: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let (token, id_str) = line
            .rsplit_once(' ')
            .expect("voice_cmn tokens file: line missing a token/id separator");
        let id: usize = id_str
            .parse()
            .expect("voice_cmn tokens file: id is not a number");
        if id >= vocab.len() {
            vocab.resize(id + 1, String::new());
        }
        vocab[id] = token.to_string();
    }
    vocab
}

fn vocab() -> &'static [String] {
    static VOCAB: OnceLock<Vec<String>> = OnceLock::new();
    VOCAB.get_or_init(|| parse_tokens_txt(TOKENS_TXT))
}

/// `"".join(tokens).replace("▁", " ").strip()` -- ported directly from
/// the spike's own working decode rule (`eval_citrinet_zh.py`), not
/// reinvented. Note there is no space between most tokens: unlike
/// English's word-per-token vocabulary, this model's raw output is
/// mostly one contiguous run of characters with `▁` appearing only at
/// whatever boundaries its own training vocabulary encoded -- callers
/// (`voice_parse.rs`) must not assume this transcript is space-delimited
/// into words the way the English pipeline's is.
fn ctc_greedy_decode(logits: &Tensor<f32>) -> String {
    let vocab = vocab();
    let text: String = ctc_greedy_decode_indices(logits, BLANK_ID)
        .into_iter()
        .map(|i| vocab[i].as_str())
        .collect();
    text.replace('▁', " ").trim().to_string()
}

/// Transcribes one spoken Mandarin command. `samples` is 16kHz mono
/// `f32` in `[-1.0, 1.0]`; `model_bytes` is `zh-citrinet-512`'s `.rten`
/// file, fetched by the host layer (no filesystem inside wasm).
///
/// Returns the raw, often-misheard transcript -- never the parsed
/// transaction. See `voice_parse::parse_voice_command`.
pub fn transcribe_voice_command_cmn(
    model_bytes: Vec<u8>,
    samples: &[f32],
) -> Result<String, BudgetError> {
    if samples.is_empty() {
        return Err(BudgetError::EmptyAudio);
    }

    let model =
        Model::load(model_bytes).map_err(|e| BudgetError::VoiceModelLoadFailed(e.to_string()))?;
    // Looked up by name, not `input_ids().first()` -- this model has two
    // inputs (`audio_signal`, `length`) and nothing guarantees graph
    // export order, unlike `voice.rs`'s single-input `QuartzNet15x5`.
    let audio_input_id = model.find_node("audio_signal").ok_or_else(|| {
        BudgetError::VoiceModelLoadFailed("model has no audio_signal input".into())
    })?;
    let length_input_id = model
        .find_node("length")
        .ok_or_else(|| BudgetError::VoiceModelLoadFailed("model has no length input".into()))?;
    let output_id = *model
        .output_ids()
        .first()
        .ok_or_else(|| BudgetError::VoiceModelLoadFailed("model has no output".into()))?;

    let filterbank = mel_filterbank(N_MELS);
    let (features, n_mels, n_frames, true_frames) = log_mel_features(samples, &filterbank, N_MELS);
    let input = Tensor::from_data(&[1, n_mels, n_frames], features);
    let length = Tensor::from_data(&[1], vec![true_frames as i32]);

    let [output] = model
        .run_n(
            vec![
                (audio_input_id, input.into()),
                (length_input_id, length.into()),
            ],
            [output_id],
            None,
        )
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
    fn the_tokens_file_parses_into_a_dense_vocab_with_blank_last() {
        let vocab = vocab();
        assert_eq!(vocab.len(), BLANK_ID + 1);
        assert_eq!(vocab[0], "▁");
        assert_eq!(vocab[BLANK_ID], "<blk>");
        // Every id in between was actually assigned by some line in the
        // file, not left as the `resize` filler -- a gap would mean the
        // checked-in tokens file doesn't have the dense `0..=max_id` shape
        // this parser assumes.
        assert!(vocab.iter().all(|t| !t.is_empty()));
    }

    #[test]
    fn ctc_decode_uses_a_real_vocab_entry_and_drops_the_blank() {
        // Index 2 is 'A' in the shipped tokens file (checked directly,
        // not assumed) -- using a real vocab id here means an edit that
        // shifts the tokens file would break this test, not just an
        // invented index that happens to still be in range.
        assert_eq!(vocab()[2], "A");
        let classes = vocab().len();
        let frames = 2;
        let mut data = vec![-10.0f32; frames * classes];
        data[2] = 10.0; // frame 0: 'A'
        data[classes + BLANK_ID] = 10.0; // frame 1: blank -- dropped
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode(&logits), "A");
    }

    #[test]
    fn ctc_decode_turns_the_word_marker_into_a_space() {
        let classes = vocab().len();
        let frames = 1;
        let mut data = vec![-10.0f32; frames * classes];
        data[0] = 10.0; // index 0 == '▁'
        let logits = Tensor::from_data(&[1, frames, classes], data);
        // A lone '▁' becomes a lone space, then trimmed away entirely --
        // there is no word for it to separate here.
        assert_eq!(ctc_greedy_decode(&logits), "");
    }
}
