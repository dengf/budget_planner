//! Shared NeMo-style log-mel feature extraction and CTC greedy decode,
//! factored out of `voice.rs` so a second NeMo-family model (`voice_cmn.rs`,
//! Mandarin's Citrinet-512) can reuse the exact same, already-validated DSP
//! with only its own mel-bin count and vocabulary differing -- rather than
//! risking two copies of ~150 lines of bit-for-bit-validated math silently
//! drifting apart. See `voice.rs`'s own doc comment for the full validation
//! story (checked against a numpy reference implementation).
//!
//! A model with a genuinely different feature pipeline (Cantonese's `WeNet`
//! Conformer, which uses Kaldi-style fbank with no per-utterance
//! normalization at all, not this `NeMo` recipe) does *not* belong here --
//! see `voice_fbank.rs` instead.

// Everything below down to `ctc_greedy_decode_indices` is specific to the
// NeMo log-mel recipe (`voice.rs`/`voice_cmn.rs`) -- individually gated
// so a `voice-yue`-only build (Kaldi fbank, `voice_fbank.rs`) doesn't
// compile in a whole unused DSP pipeline, which `cargo clippy
// --all-targets` (unlike a plain `cargo build --workspace`, which
// unifies every feature -- see this repo's CLAUDE.md) actually flags as
// dead code.
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) const SAMPLE_RATE: f64 = 16000.0;
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) const N_FFT: usize = 512;
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) const WIN_LENGTH: usize = 320; // 20ms
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) const HOP_LENGTH: usize = 160; // 10ms
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) const PREEMPHASIS: f64 = 0.97;
/// `2f64.powi(-24)`, `NeMo`'s log guard against a zero-energy mel bin.
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) const LOG_GUARD: f64 = 5.960_464_477_539_063e-8;
/// The conv stack of every model built on this pipeline needs the time
/// axis padded to a multiple of this, or the model produces a shape
/// mismatch rather than a wrong answer -- an error, not a silent-garbage
/// risk, but worth avoiding.
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) const FRAME_PAD_MULTIPLE: usize = 16;

#[cfg(any(feature = "voice", feature = "voice-cmn"))]
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

#[cfg(any(feature = "voice", feature = "voice-cmn"))]
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

/// `librosa.filters.mel(sr=16000, n_fft=512, n_mels=<n_mels>, norm="slaney",
/// htk=False)` -- `NeMo`'s default mel filterbank, reimplemented rather
/// than depended on (no pure-Rust equivalent exists that matches
/// librosa's exact normalization).
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) fn mel_filterbank(n_mels: usize) -> Vec<Vec<f64>> {
    let n_bins = N_FFT / 2 + 1;
    let fftfreqs: Vec<f64> = (0..n_bins)
        .map(|k| k as f64 * SAMPLE_RATE / N_FFT as f64)
        .collect();

    let lo = hz_to_mel(0.0);
    let hi = hz_to_mel(SAMPLE_RATE / 2.0);
    let mel_points: Vec<f64> = (0..n_mels + 2)
        .map(|i| mel_to_hz(lo + (hi - lo) * i as f64 / (n_mels + 1) as f64))
        .collect();

    let mut weights = vec![vec![0.0f64; n_bins]; n_mels];
    for i in 0..n_mels {
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
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
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
/// `[n_mels, n_frames]` -- the layout this whole model family's
/// `audio_signal` input wants. `n_frames` is already padded to a multiple
/// of `FRAME_PAD_MULTIPLE`.
#[cfg(any(feature = "voice", feature = "voice-cmn"))]
pub(crate) fn log_mel_features(
    samples: &[f32],
    filterbank: &[Vec<f64>],
    n_mels: usize,
) -> (Vec<f32>, usize, usize) {
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

    let mut mel = vec![0.0f64; n_mels * n_frames.max(1)];
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
        for m in 0..n_mels {
            let mut acc = 0.0f64;
            for k in 0..n_bins {
                acc += filterbank[m][k] * power[k];
            }
            mel[m * n_frames.max(1) + t] = (acc + LOG_GUARD).ln();
        }
    }

    // Per-feature normalization; `torch .std()` is unbiased (ddof=1).
    for m in 0..n_mels {
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
    let mut out = vec![0.0f32; n_mels * total_frames];
    for m in 0..n_mels {
        for t in 0..n_frames {
            out[m * total_frames + t] = mel[m * n_frames.max(1) + t] as f32;
        }
    }
    (out, n_mels, total_frames)
}

/// Greedy CTC decode: argmax per frame, collapse immediate repeats, drop
/// the blank. Pure and model-independent (index-only, no label lookup),
/// so it is tested without ever loading a model and is shared by every
/// model on this pipeline regardless of vocabulary size or blank position.
pub(crate) fn ctc_greedy_decode_indices(
    logits: &rten_tensor::Tensor<f32>,
    blank: usize,
) -> Vec<usize> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(feature = "voice", feature = "voice-cmn"))]
    #[test]
    fn the_filterbank_has_one_row_per_mel_bin_and_is_never_negative() {
        for n_mels in [64, 80] {
            let fb = mel_filterbank(n_mels);
            assert_eq!(fb.len(), n_mels);
            for row in &fb {
                assert_eq!(row.len(), N_FFT / 2 + 1);
                assert!(row.iter().all(|&w| w >= 0.0));
            }
        }
    }

    #[cfg(any(feature = "voice", feature = "voice-cmn"))]
    #[test]
    fn features_are_padded_to_a_multiple_of_16_frames() {
        for n_mels in [64, 80] {
            let fb = mel_filterbank(n_mels);
            // ~1 second of silence.
            let samples = vec![0.0f32; 16000];
            let (data, mels, n_frames) = log_mel_features(&samples, &fb, n_mels);
            assert_eq!(mels, n_mels);
            assert_eq!(n_frames % FRAME_PAD_MULTIPLE, 0);
            assert_eq!(data.len(), mels * n_frames);
        }
    }

    #[cfg(any(feature = "voice", feature = "voice-cmn"))]
    #[test]
    fn silence_produces_finite_normalized_features_not_nan() {
        // A real silent recording is often bit-exact zero -- the log
        // guard and the `+ 1e-5` std floor both exist to keep this from
        // producing NaN or -inf, which would otherwise poison every
        // downstream conv layer silently.
        let fb = mel_filterbank(80);
        let samples = vec![0.0f32; 16000];
        let (data, _, _) = log_mel_features(&samples, &fb, 80);
        assert!(data.iter().all(|v| v.is_finite()));
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
        let logits = rten_tensor::Tensor::from_data(&[1, frames, classes], data);
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
        let logits = rten_tensor::Tensor::from_data(&[1, frames, classes], data);
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
        let logits = rten_tensor::Tensor::from_data(&[1, frames, classes], data);
        assert_eq!(ctc_greedy_decode_indices(&logits, blank), vec![3usize]);
    }
}
