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

// `rten_embed` is this crate's Cargo.toml alias for a *second*, 0.26.0
// pin of the plain `rten` crate -- reused from `embed_classify.rs` rather
// than adding a third pin, since both are single-forward-pass models on
// the same runtime. See that Cargo.toml feature's own doc comment.
use rten_embed::Model;
use rten_tensor::prelude::*;
use rten_tensor::Tensor;

use budget_core::BudgetError;

const SAMPLE_RATE: f64 = 16000.0;
const N_FFT: usize = 512;
const WIN_LENGTH: usize = 320; // 20ms
const HOP_LENGTH: usize = 160; // 10ms
const N_MELS: usize = 64;
const PREEMPHASIS: f64 = 0.97;
/// `2f64.powi(-24)`, `NeMo`'s log guard against a zero-energy mel bin.
const LOG_GUARD: f64 = 5.960_464_477_539_063e-8;
/// `QuartzNet`'s conv stack needs the time axis padded to a multiple of
/// this, or the model produces a shape mismatch rather than a wrong
/// answer -- an error, not a silent-garbage risk, but worth avoiding.
const FRAME_PAD_MULTIPLE: usize = 16;

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

// ---------------------------------------------------------------------
// Log-mel feature extraction: NeMo's `AudioToMelSpectrogramPreprocessor`,
// the exact configuration QuartzNet15x5 was trained with. Every constant
// above is a silent-garbage risk if wrong -- this was validated against
// a numpy reference implementation of the same preprocessor (bit-for-bit,
// not just close) before being trusted, and ported here unchanged.
// ---------------------------------------------------------------------

fn hz_to_mel(f: f64) -> f64 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = 6.4f64.ln() / 27.0;
    if f >= min_log_hz {
        min_log_mel + (f / min_log_hz).ln() / logstep
    } else {
        f / f_sp
    }
}

fn mel_to_hz(m: f64) -> f64 {
    let f_sp = 200.0 / 3.0;
    let min_log_hz = 1000.0;
    let min_log_mel = min_log_hz / f_sp;
    let logstep = 6.4f64.ln() / 27.0;
    if m >= min_log_mel {
        min_log_hz * (logstep * (m - min_log_mel)).exp()
    } else {
        f_sp * m
    }
}

/// `librosa.filters.mel(sr=16000, n_fft=512, n_mels=64, norm="slaney",
/// htk=False)` -- `NeMo`'s default mel filterbank, reimplemented rather
/// than depended on (no pure-Rust equivalent exists that matches
/// librosa's exact normalization).
fn mel_filterbank() -> Vec<Vec<f64>> {
    let n_bins = N_FFT / 2 + 1;
    let fftfreqs: Vec<f64> = (0..n_bins)
        .map(|k| k as f64 * SAMPLE_RATE / N_FFT as f64)
        .collect();

    let lo = hz_to_mel(0.0);
    let hi = hz_to_mel(SAMPLE_RATE / 2.0);
    let mel_points: Vec<f64> = (0..N_MELS + 2)
        .map(|i| mel_to_hz(lo + (hi - lo) * i as f64 / (N_MELS + 1) as f64))
        .collect();

    let mut weights = vec![vec![0.0f64; n_bins]; N_MELS];
    for i in 0..N_MELS {
        let fdiff_lo = mel_points[i + 1] - mel_points[i];
        let fdiff_hi = mel_points[i + 2] - mel_points[i + 1];
        for (k, &freq) in fftfreqs.iter().enumerate() {
            let lower = -(mel_points[i] - freq) / fdiff_lo;
            let upper = (mel_points[i + 2] - freq) / fdiff_hi;
            weights[i][k] = lower.min(upper).max(0.0);
        }
        // Slaney normalization: equal area under each filter.
        let enorm = 2.0 / (mel_points[i + 2] - mel_points[i]);
        for w in &mut weights[i] {
            *w *= enorm;
        }
    }
    weights
}

/// Symmetric Hann window (`torch.hann_window(WIN_LENGTH,
/// periodic=False)`), zero-padded from `WIN_LENGTH` up to `N_FFT`.
fn hann_window() -> Vec<f64> {
    let mut window = vec![0.0f64; N_FFT];
    let left_pad = (N_FFT - WIN_LENGTH) / 2;
    for i in 0..WIN_LENGTH {
        window[left_pad + i] =
            0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / (WIN_LENGTH - 1) as f64).cos();
    }
    window
}

/// 16kHz mono samples in; `(features, n_mels, n_frames)` out, row-major
/// `[n_mels, n_frames]` -- the layout `QuartzNet`'s `audio_signal` input
/// wants. `n_frames` is already padded to a multiple of
/// `FRAME_PAD_MULTIPLE`.
fn log_mel_features(samples: &[f32], filterbank: &[Vec<f64>]) -> (Vec<f32>, usize, usize) {
    let x: Vec<f64> = samples.iter().map(|&s| s as f64).collect();

    // Preemphasis; the first sample is left untouched.
    let mut pre = vec![0.0f64; x.len()];
    if !x.is_empty() {
        pre[0] = x[0];
        for i in 1..x.len() {
            pre[i] = x[i] - PREEMPHASIS * x[i - 1];
        }
    }

    // `center=True` reflect padding, matching `torch.stft`'s default.
    let pad = N_FFT / 2;
    let mut padded = Vec::with_capacity(pre.len() + 2 * pad);
    for j in 0..pad {
        padded.push(pre[(pad - j).min(pre.len().saturating_sub(1))]);
    }
    padded.extend_from_slice(&pre);
    for j in 0..pad {
        let idx = pre.len().saturating_sub(2 + j);
        padded.push(pre.get(idx).copied().unwrap_or(0.0));
    }

    let window = hann_window();
    let n_frames = if padded.len() >= N_FFT {
        1 + (padded.len() - N_FFT) / HOP_LENGTH
    } else {
        0
    };
    let n_bins = N_FFT / 2 + 1;

    let mut planner = rustfft::FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(N_FFT);

    let mut mel = vec![0.0f64; N_MELS * n_frames.max(1)];
    let mut buf = vec![rustfft::num_complex::Complex::new(0.0f64, 0.0); N_FFT];
    for t in 0..n_frames {
        for i in 0..N_FFT {
            buf[i] =
                rustfft::num_complex::Complex::new(padded[t * HOP_LENGTH + i] * window[i], 0.0);
        }
        fft.process(&mut buf);
        let power: Vec<f64> = buf[..n_bins]
            .iter()
            .map(rustfft::num_complex::Complex::norm_sqr)
            .collect();
        for m in 0..N_MELS {
            let mut acc = 0.0f64;
            for k in 0..n_bins {
                acc += filterbank[m][k] * power[k];
            }
            mel[m * n_frames.max(1) + t] = (acc + LOG_GUARD).ln();
        }
    }

    // Per-feature normalization; `torch .std()` is unbiased (ddof=1).
    for m in 0..N_MELS {
        let row = &mel[m * n_frames.max(1)..m * n_frames.max(1) + n_frames];
        if n_frames < 2 {
            continue;
        }
        let mean = row.iter().sum::<f64>() / n_frames as f64;
        let var = row.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n_frames as f64 - 1.0);
        let std = var.sqrt() + 1e-5;
        for t in 0..n_frames {
            mel[m * n_frames.max(1) + t] = (mel[m * n_frames.max(1) + t] - mean) / std;
        }
    }

    let pad_amount = (FRAME_PAD_MULTIPLE - n_frames % FRAME_PAD_MULTIPLE) % FRAME_PAD_MULTIPLE;
    let total_frames = n_frames + pad_amount;
    let mut out = vec![0.0f32; N_MELS * total_frames];
    for m in 0..N_MELS {
        for t in 0..n_frames {
            out[m * total_frames + t] = mel[m * n_frames.max(1) + t] as f32;
        }
    }
    (out, N_MELS, total_frames)
}

/// Greedy CTC decode: argmax per frame, collapse immediate repeats, drop
/// the blank. Pure and model-independent, so it is tested without ever
/// loading a model.
fn ctc_greedy_decode(logits: &Tensor<f32>) -> String {
    let frames = logits.shape()[1];
    let classes = logits.shape()[2];
    let mut text = String::new();
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
        if best != prev && best != QUARTZNET_BLANK {
            text.push_str(quartznet_label(best));
        }
        prev = best;
    }
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

    let filterbank = mel_filterbank();
    let (features, n_mels, n_frames) = log_mel_features(samples, &filterbank);
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
    fn the_filterbank_has_one_row_per_mel_bin_and_is_never_negative() {
        let fb = mel_filterbank();
        assert_eq!(fb.len(), N_MELS);
        for row in &fb {
            assert_eq!(row.len(), N_FFT / 2 + 1);
            assert!(row.iter().all(|&w| w >= 0.0));
        }
    }

    #[test]
    fn features_are_padded_to_a_multiple_of_16_frames() {
        let fb = mel_filterbank();
        // ~1 second of silence.
        let samples = vec![0.0f32; 16000];
        let (data, n_mels, n_frames) = log_mel_features(&samples, &fb);
        assert_eq!(n_mels, N_MELS);
        assert_eq!(n_frames % FRAME_PAD_MULTIPLE, 0);
        assert_eq!(data.len(), n_mels * n_frames);
    }

    #[test]
    fn silence_produces_finite_normalized_features_not_nan() {
        // A real silent recording is often bit-exact zero -- the log
        // guard and the `+ 1e-5` std floor both exist to keep this from
        // producing NaN or -inf, which would otherwise poison every
        // downstream conv layer silently.
        let fb = mel_filterbank();
        let samples = vec![0.0f32; 16000];
        let (data, _, _) = log_mel_features(&samples, &fb);
        assert!(data.iter().all(|v| v.is_finite()));
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
