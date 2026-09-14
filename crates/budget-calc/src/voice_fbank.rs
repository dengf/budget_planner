//! Kaldi-style fbank feature extraction for Cantonese's `WeNet`
//! Conformer-CTC model (`voice_yue.rs`) -- a genuinely different DSP
//! pipeline from `voice_mel.rs`'s `NeMo` log-mel recipe, not a
//! reparameterization of it: HTK/Kaldi's single-formula mel scale (not
//! Slaney's, which `voice_mel.rs` uses because that's what `NeMo` trained
//! against), a Povey analysis window (not Hann), non-normalized
//! triangular mel filters (no Slaney equal-area scaling), Kaldi's
//! `snip_edges=false` reflect-padded framing, and critically **no
//! per-utterance mean/variance normalization at all** -- confirmed
//! against the real model's own `sherpa_onnx.FeatureExtractorConfig`
//! (`sampling_rate=16000, feature_dim=80, low_freq=20, high_freq=-400,
//! dither=0, normalize_samples=True, snip_edges=False`) rather than
//! assumed, and ported from Kaldi/`kaldi-native-fbank`'s own published
//! C++ source (`feature-window.h`, `mel-computations.h`), not
//! reinvented.
//!
//! Validated against a real Python `kaldi_native_fbank.OnlineFbank` run
//! configured with these exact options: this module's test embeds that
//! run's first two output frames for a small fixed synthetic waveform
//! (not a checked-in audio file, so this test has no Python dependency
//! in CI) and asserts the Rust output matches within float tolerance --
//! seeded per the plan's explicit requirement that this pipeline stay
//! unverified only until that direct comparison is done.

const SAMPLE_RATE: f64 = 16000.0;
const FRAME_SHIFT: usize = 160; // 10ms
const FRAME_LENGTH: usize = 400; // 25ms
const PADDED_SIZE: usize = 512; // next power of two >= FRAME_LENGTH
const PREEMPHASIS: f32 = 0.97;
/// `sherpa_onnx.FeatureExtractorConfig.normalize_samples=True`: this
/// model's fbank recipe was trained against 16-bit-PCM-scale amplitude,
/// not `[-1.0, 1.0]` float samples -- every other model in this codebase
/// (`voice_mel.rs`) takes `[-1.0, 1.0]` directly, so this scale-up is
/// specific to this one pipeline.
const SAMPLE_SCALE: f32 = 32768.0;

/// Kaldi/HTK mel scale -- a single formula across the whole range, unlike
/// `voice_mel.rs::hz_to_mel`'s Slaney formula, which switches to a linear
/// segment below 1000Hz. Confirmed against `kaldi-native-fbank`'s own
/// `MelBanks::MelScale` (`is_librosa=false`, the default, is what this
/// model's own feature config leaves unset).
fn hz_to_mel(f: f64) -> f64 {
    1127.0 * (1.0 + f / 700.0).ln()
}

/// `pow(0.5 - 0.5*cos(2*pi*n/(N-1)), 0.85)` -- Kaldi's own window,
/// documented in `feature-window.h` as "similar to Hamming but goes to
/// zero at the edges"; not Hann/Hamming, and not the same shape as
/// `voice_mel.rs::hann_window`. Length `FRAME_LENGTH` (400), not the
/// FFT's padded size -- the padding to `PADDED_SIZE` happens after this
/// window is applied, as zeros.
fn povey_window() -> Vec<f32> {
    (0..FRAME_LENGTH)
        .map(|n| {
            let x = 0.5
                - 0.5 * (2.0 * std::f64::consts::PI * n as f64 / (FRAME_LENGTH - 1) as f64).cos();
            x.powf(0.85) as f32
        })
        .collect()
}

/// Kaldi's triangular mel filterbank: unlike `voice_mel.rs::mel_filterbank`,
/// weights are the raw linear ramp (0 at each edge, 1 at the center),
/// never rescaled for equal filter area -- Slaney normalization is a
/// librosa/`NeMo` detail this recipe doesn't have. `num_fft_bins` is
/// `PADDED_SIZE / 2`, not `/ 2 + 1`: Kaldi's own mel-filter construction
/// never looks at the Nyquist bin at all, so `voice_fbank_features`
/// below only computes power for indices `0..num_fft_bins`, matching
/// this filterbank's shape exactly rather than the one-wider shape
/// `voice_mel.rs` uses for its own (different) recipe.
fn mel_filterbank(num_bins: usize, low_freq: f64, high_freq_offset: f64) -> Vec<Vec<f32>> {
    let nyquist = SAMPLE_RATE / 2.0;
    let high_freq = if high_freq_offset > 0.0 {
        high_freq_offset
    } else {
        nyquist + high_freq_offset
    };
    let num_fft_bins = PADDED_SIZE / 2;
    let fft_bin_width = SAMPLE_RATE / PADDED_SIZE as f64;

    let mel_low = hz_to_mel(low_freq);
    let mel_high = hz_to_mel(high_freq);
    let mel_delta = (mel_high - mel_low) / (num_bins + 1) as f64;

    let mut weights = vec![vec![0.0f32; num_fft_bins]; num_bins];
    for (bin, row) in weights.iter_mut().enumerate() {
        let left_mel = mel_low + bin as f64 * mel_delta;
        let center_mel = mel_low + (bin + 1) as f64 * mel_delta;
        let right_mel = mel_low + (bin + 2) as f64 * mel_delta;
        for (i, w_out) in row.iter_mut().enumerate() {
            let freq = fft_bin_width * i as f64;
            let mel = hz_to_mel(freq);
            if mel > left_mel && mel < right_mel {
                let w = if mel <= center_mel {
                    (mel - left_mel) / (center_mel - left_mel)
                } else {
                    (right_mel - mel) / (right_mel - center_mel)
                };
                *w_out = w as f32;
            }
        }
    }
    weights
}

/// Reflects an out-of-range sample index back into `[0, len)`, Kaldi's
/// own edge handling for `snip_edges=false` (`ExtractWindow` in
/// `feature-window.cc`) -- e.g. index `-1` becomes `0`, index `len`
/// becomes `len-1`. Looped rather than a single reflection since a very
/// short waveform's first/last frame can, in principle, need more than
/// one bounce (never happens for a real recording many frames long, but
/// this matches the reference implementation's own loop rather than
/// assuming it can't).
fn reflect_index(mut i: i64, len: usize) -> usize {
    let len = len as i64;
    loop {
        if i < 0 {
            i = -i - 1;
        } else if i >= len {
            i = 2 * len - 1 - i;
        } else {
            return i as usize;
        }
    }
}

/// Number of frames Kaldi's `snip_edges=false` framing produces for
/// `num_samples` samples -- `(num_samples + frame_shift/2) / frame_shift`,
/// integer division, ported directly from `feature-window.h`'s `NumFrames`
/// (the `flush=true` branch, the only one offline extraction ever uses).
fn num_frames(num_samples: usize) -> usize {
    (num_samples + FRAME_SHIFT / 2) / FRAME_SHIFT
}

/// Extracts frame `f`'s `FRAME_LENGTH` raw samples under `snip_edges=false`:
/// the frame is centered on `f*FRAME_SHIFT + FRAME_SHIFT/2`, so the first
/// and last frames legitimately reach before sample 0 or past the end --
/// `reflect_index` mirrors those back in, rather than the truncate-only
/// behavior `snip_edges=true` would use (and which `voice_mel.rs`'s
/// `center=True` reflect-pad approximates differently for its own recipe).
fn extract_frame(samples: &[f32], f: usize) -> Vec<f32> {
    let midpoint = (f * FRAME_SHIFT + FRAME_SHIFT / 2) as i64;
    let start = midpoint - (FRAME_LENGTH / 2) as i64;
    (0..FRAME_LENGTH)
        .map(|s| samples[reflect_index(start + s as i64, samples.len())])
        .collect()
}

/// One frame's `use_log_fbank` features: preemphasis + DC removal +
/// Povey window on the raw frame, zero-padded to `PADDED_SIZE`, FFT'd,
/// mel-filtered, then logged with Kaldi's own epsilon floor (never
/// normalized against other frames -- there is no CMVN step in this
/// recipe at all, unlike every mean/std step in `voice_mel.rs`).
fn frame_features(
    raw_frame: &[f32],
    window: &[f32],
    filterbank: &[Vec<f32>],
    fft: &std::sync::Arc<dyn rustfft::Fft<f64>>,
) -> Vec<f32> {
    // Dither is 0 for this model (confirmed via the real feature config),
    // so that step of Kaldi's own pipeline is skipped entirely here.
    let mean = raw_frame.iter().sum::<f32>() / raw_frame.len() as f32;
    let mut windowed = vec![0.0f32; raw_frame.len()];
    for i in 0..raw_frame.len() {
        windowed[i] = raw_frame[i] - mean;
    }
    // Preemphasis, applied right-to-left so `windowed[i-1]` is still the
    // pre-emphasis value when it's used -- same as Kaldi's own in-place
    // loop direction.
    for i in (1..windowed.len()).rev() {
        windowed[i] -= PREEMPHASIS * windowed[i - 1];
    }
    windowed[0] -= PREEMPHASIS * windowed[0];

    for (i, w) in window.iter().enumerate() {
        windowed[i] *= w;
    }

    let num_fft_bins = PADDED_SIZE / 2;
    let mut buf = vec![rustfft::num_complex::Complex::new(0.0f64, 0.0); PADDED_SIZE];
    for (i, &v) in windowed.iter().enumerate() {
        buf[i] = rustfft::num_complex::Complex::new(v as f64, 0.0);
    }
    fft.process(&mut buf);
    let power: Vec<f32> = buf[..num_fft_bins]
        .iter()
        .map(|c| c.norm_sqr() as f32)
        .collect();

    filterbank
        .iter()
        .map(|filter| {
            let energy: f32 = filter.iter().zip(&power).map(|(w, p)| w * p).sum();
            energy.max(f32::EPSILON).ln()
        })
        .collect()
}

/// `[-1.0, 1.0]` 16kHz mono samples in; `(features, n_mels, n_frames)`
/// out, row-major `[n_mels, n_frames]` -- same output shape convention
/// as `voice_mel::log_mel_features`, so `voice_yue.rs` can build its
/// model input tensor the same way `voice_cmn.rs` does. No frame-count
/// padding here (unlike `voice_mel.rs`'s `FRAME_PAD_MULTIPLE`): the `WeNet`
/// Conformer export this feeds has no matching conv-stride constraint
/// that was found in the spike, and padding un-asked-for silence into a
/// short recording would change the model's own (already-correct)
/// output length assumptions.
pub(crate) fn fbank_features(
    samples: &[f32],
    filterbank: &[Vec<f32>],
    num_bins: usize,
) -> (Vec<f32>, usize, usize) {
    let scaled: Vec<f32> = samples.iter().map(|&s| s * SAMPLE_SCALE).collect();
    let n_frames = if scaled.is_empty() {
        0
    } else {
        num_frames(scaled.len())
    };
    let window = povey_window();
    let mut planner = rustfft::FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(PADDED_SIZE);

    let mut out = vec![0.0f32; num_bins * n_frames.max(1)];
    for t in 0..n_frames {
        let raw = extract_frame(&scaled, t);
        let feats = frame_features(&raw, &window, filterbank, &fft);
        for (m, &v) in feats.iter().enumerate() {
            out[m * n_frames.max(1) + t] = v;
        }
    }
    (out, num_bins, n_frames)
}

pub(crate) fn yue_mel_filterbank(num_bins: usize) -> Vec<Vec<f32>> {
    mel_filterbank(num_bins, 20.0, -400.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small, fully deterministic two-tone waveform -- not a checked-in
    /// audio file, so this reference needs no Python dependency in CI.
    /// The corresponding first-two-frame values below were dumped from a
    /// real `kaldi_native_fbank.OnlineFbank` run (`FbankOptions` with
    /// `dither=0, snip_edges=False, num_bins=80, low_freq=20,
    /// high_freq=-400`, the exact config confirmed against
    /// `sherpa_onnx.FeatureExtractorConfig`) fed these same 800 samples
    /// scaled by 32768 -- per the plan's explicit requirement to validate
    /// this pipeline against real Python output before wiring it in.
    fn synthetic_samples() -> Vec<f32> {
        (0..800)
            .map(|n| {
                let t = n as f64;
                (0.1 * (2.0 * std::f64::consts::PI * 440.0 * t / 16000.0).sin()
                    + 0.05 * (2.0 * std::f64::consts::PI * 1200.0 * t / 16000.0).sin())
                    as f32
            })
            .collect()
    }

    #[test]
    fn produces_the_frame_count_kaldis_snip_edges_false_formula_predicts() {
        // (800 + 80) / 160 = 5, integer division -- confirmed against the
        // real Python run, which reported exactly 5 frames for this input.
        assert_eq!(num_frames(800), 5);
        let fb = yue_mel_filterbank(80);
        let (_, _, n_frames) = fbank_features(&synthetic_samples(), &fb, 80);
        assert_eq!(n_frames, 5);
    }

    #[test]
    fn matches_the_real_kaldi_native_fbank_reference_within_tolerance() {
        let fb = yue_mel_filterbank(80);
        let (data, num_bins, n_frames) = fbank_features(&synthetic_samples(), &fb, 80);
        assert_eq!(num_bins, 80);

        let frame0_expected: [f32; 5] = [13.179_926, 13.874_611, 14.143_15, 14.449_106, 14.897_824];
        let frame1_expected: [f32; 5] = [5.880_062, 6.490_823, 5.677_254, 4.960_998, 6.863_027];
        for i in 0..5 {
            let got0 = data[i * n_frames];
            let got1 = data[i * n_frames + 1];
            assert!(
                (got0 - frame0_expected[i]).abs() < 5e-2,
                "frame0[{i}]: got {got0}, expected {}",
                frame0_expected[i]
            );
            assert!(
                (got1 - frame1_expected[i]).abs() < 5e-2,
                "frame1[{i}]: got {got1}, expected {}",
                frame1_expected[i]
            );
        }
    }

    #[test]
    fn silence_produces_finite_features_not_nan() {
        let fb = yue_mel_filterbank(80);
        let samples = vec![0.0f32; 1600];
        let (data, _, _) = fbank_features(&samples, &fb, 80);
        assert!(data.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn the_filterbank_never_touches_the_nyquist_bin() {
        // Kaldi's own mel-filter construction only ever looks at
        // `PADDED_SIZE / 2` fft bins, not `/ 2 + 1` -- pinned explicitly
        // since getting this off-by-one wrong silently shifts every mel
        // bin's frequency mapping rather than erroring.
        let fb = yue_mel_filterbank(80);
        for row in &fb {
            assert_eq!(row.len(), PADDED_SIZE / 2);
        }
    }
}
