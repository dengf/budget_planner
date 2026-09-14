//! Cantonese speech-to-text via `sherpa-onnx-wenetspeech-yue-u2pp-conformer-ctc`
//! (a `WeNet` Conformer, CTC-only export) -- see `voice_fbank.rs` for the
//! Kaldi-style fbank DSP this model needs, a materially different recipe
//! from `voice_mel.rs`'s `NeMo` log-mel one that `voice.rs`/`voice_cmn.rs`
//! share.
//!
//! Measured in the spike that preceded this module: 88% effective
//! accuracy on 25 TTS-generated test utterances once two systematic
//! artifacts are normalized away in `voice_parse.rs` -- the model outputs
//! Simplified characters even for Cantonese speech, and 使咗 is a real
//! homophone slip for the intended 洗咗 -- see `normalize_yue`.
//!
//! **Blank is first here, index 0** -- confirmed by reading the model's
//! own shipped tokens file, and the opposite of every other model in this
//! codebase (`QuartzNet15x5`/`zh-citrinet-512` both put blank last). This
//! is guarded by an explicit test below since getting it wrong produces
//! confident nonsense, not an error.
//!
//! **Decode rule is identical to `voice_cmn.rs`'s**, not a bespoke
//! CJK/ASCII-run heuristic as originally speculated: this vocab mixes CJK
//! characters with whole English BPE pieces, and the English pieces
//! already carry a `▁` word-boundary marker the same way Mandarin's
//! vocabulary does (confirmed empirically against real spliced
//! Cantonese+English audio: `我用▁WIFI使咗五十蚊` decodes with a space
//! before "WIFI" from the `▁WI` token and no space after it or between
//! any CJK characters, exactly what `"".join(tokens).replace("▁",
//! " ").strip()` already produces) -- so this module reuses that same
//! join rule rather than inventing a new one.

use rten_embed::Model;
use rten_tensor::Tensor;
use std::sync::OnceLock;

use budget_core::BudgetError;

use crate::voice_fbank::{fbank_features, yue_mel_filterbank};
use crate::voice_mel::ctc_greedy_decode_indices;

const N_MELS: usize = 80;

/// Confirmed by reading the model's own shipped tokens file: `<blank>` is
/// first, not last -- see this module's own doc comment.
const BLANK_ID: usize = 0;

const TOKENS_TXT: &str = include_str!("../assets/voice/yue-conformer-tokens.txt");

/// Same dense `token<space>id` parser as `voice_cmn.rs`'s -- this file's
/// own shape (checked directly: no line lacks a separating space, and no
/// token itself contains a literal ASCII space) is identical, just a
/// different vocabulary.
fn parse_tokens_txt(text: &str) -> Vec<String> {
    let mut vocab: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.is_empty() {
            continue;
        }
        let (token, id_str) = line
            .rsplit_once(' ')
            .expect("voice_yue tokens file: line missing a token/id separator");
        let id: usize = id_str
            .parse()
            .expect("voice_yue tokens file: id is not a number");
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

/// Identical join rule to `voice_cmn.rs::ctc_greedy_decode` -- see this
/// module's own doc comment for why no bespoke CJK/ASCII heuristic is
/// needed despite this vocab mixing CJK characters and whole English
/// words.
fn ctc_greedy_decode(logits: &Tensor<f32>) -> String {
    let vocab = vocab();
    let text: String = ctc_greedy_decode_indices(logits, BLANK_ID)
        .into_iter()
        .map(|i| vocab[i].as_str())
        .collect();
    text.replace('▁', " ").trim().to_string()
}

/// Transcribes one spoken Cantonese command. `samples` is 16kHz mono
/// `f32` in `[-1.0, 1.0]`; `model_bytes` is the `WeNet` Conformer's `.rten`
/// file, fetched by the host layer (no filesystem inside wasm).
///
/// Returns the raw, often-misheard transcript -- never the parsed
/// transaction. See `voice_parse::parse_voice_command`, which also
/// applies `normalize_yue` to correct this model's own systematic
/// script/homophone artifacts before matching.
pub fn transcribe_voice_command_yue(
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

    let filterbank = yue_mel_filterbank(N_MELS);
    let (features, n_mels, n_frames) = fbank_features(samples, &filterbank, N_MELS);
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
        let err = transcribe_voice_command_yue(vec![], &[]).unwrap_err();
        assert_eq!(err, BudgetError::EmptyAudio);
    }

    #[test]
    fn garbage_model_bytes_fail_to_load_rather_than_panicking() {
        let samples = vec![0.0f32; 1600];
        let err = transcribe_voice_command_yue(b"not a model".to_vec(), &samples).unwrap_err();
        assert!(matches!(err, BudgetError::VoiceModelLoadFailed(_)));
    }

    #[test]
    fn the_tokens_file_parses_into_a_dense_vocab_with_blank_first() {
        let vocab = vocab();
        assert_eq!(vocab.len(), 8629);
        assert_eq!(vocab[BLANK_ID], "<blank>");
        assert_eq!(vocab[1], "<unk>");
        assert!(vocab.iter().all(|t| !t.is_empty()));
    }

    #[test]
    fn ctc_decode_uses_a_real_vocab_entry_and_drops_the_blank_from_index_zero() {
        // Index 2 is the ASCII apostrophe in the shipped tokens file
        // (checked directly) -- proves blank is read as a real parameter
        // rather than an assumed-last index, since blank=0 here would
        // wrongly drop this token too if the decode function hardcoded
        // "blank is whichever index is 0".
        assert_eq!(vocab()[2], "'");
        let classes = vocab().len();
        let frames = 2;
        let mut data = vec![-10.0f32; frames * classes];
        data[BLANK_ID] = 10.0; // frame 0: blank -- dropped
        data[classes + 2] = 10.0; // frame 1: '\''
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode(&logits), "'");
    }

    #[test]
    fn ctc_decode_turns_the_word_marker_into_a_space_between_english_pieces() {
        // Real indices from the shipped tokens file: 1950 = "▁WI", 88 =
        // "F", 114 = "I" -- the exact sequence a real spliced-audio test
        // this session produced for the English loanword "WiFi".
        assert_eq!(vocab()[1950], "▁WI");
        assert_eq!(vocab()[88], "F");
        assert_eq!(vocab()[114], "I");
        let classes = vocab().len();
        let frames = 3;
        let mut data = vec![-10.0f32; frames * classes];
        data[1950] = 10.0;
        data[classes + 88] = 10.0;
        data[2 * classes + 114] = 10.0;
        let logits = Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode(&logits), "WIFI");
    }
}
