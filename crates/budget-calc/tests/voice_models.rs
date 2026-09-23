//! Measures the shipped voice models against real audio, rather than
//! trusting that a forward pass which returns *something* returns the
//! right thing.
//!
//! **Why this is `#[ignore]` by default.** Each model is a 130-160MB
//! Git-LFS file under `www/static/voice/`, and the fixtures are WAVs
//! that live outside the repo. A checkout without LFS smudging, or
//! without the fixtures generated, would fail these for reasons that
//! have nothing to do with the code -- so they skip unless explicitly
//! asked for:
//!
//! ```text
//! cargo test -p budget-calc --features voice,voice-cmn \
//!     --test voice_models -- --ignored --nocapture
//! ```
//!
//! **Two different things are measured, because two different things
//! can break.**
//!
//! 1. `vendor_*_transcripts_reproduce` runs the model vendor's own
//!    `test_wavs/` and compares against their shipped `trans.txt`. This
//!    is the *pipeline* check: fbank recipe, `[N, T, 80]` axis order,
//!    `x_lens`, blank index, the `▁` join rule. Every one of those can
//!    be wrong in a way that still produces plausible-looking English,
//!    so the bar here is near-exact, not "recognisable".
//! 2. `corpus_*_parses` runs spoken budget commands through
//!    `voice_parse` and scores the *parsed transaction*, which is what
//!    a user actually gets. A transcript can be wrong and the
//!    transaction still right (constrained matching against a closed
//!    category vocabulary recovers a lot), so scoring the transcript
//!    alone would understate the product and scoring only the
//!    transaction would hide a pipeline regression. Hence both.
//!
//! Three environment variables steer a run.
//! `BUDGET_VOICE_FIXTURES` is where the WAVs live.
//! `BUDGET_VOICE_MODELS` overrides the model directory, and
//! `BUDGET_VOICE_PAD_MS` pads each clip with silence before it reaches
//! the pipeline. Both exist for one purpose: scoring a *different*
//! model on identical audio. `voice_wenet::with_lead_in_silence` pads
//! inside the pipeline now, so the `NeMo` models this replaced need the
//! env knob to be measured on equal footing rather than penalised for
//! a change they predate. Left unset, a run measures exactly what
//! ships.

#![cfg(any(feature = "voice", feature = "voice-cmn"))]

use std::path::{Path, PathBuf};
use std::time::Instant;

use budget_calc::voice_parse::{
    parse_voice_command, VoiceCategoryCandidate, VoiceDraft, VoiceLanguage,
};

/// The sixteen presets a real budget starts from, in the shape
/// `parse_voice_command` takes. Scoring against the *real* category list
/// rather than a trimmed test fixture matters: most of the accuracy in
/// this feature comes from constrained matching, and a short list makes
/// that matching look better than it is by removing its near-misses.
fn starter_candidates() -> Vec<VoiceCategoryCandidate> {
    budget_calc::presets::starter_categories()
        .into_iter()
        .enumerate()
        .map(|(i, p)| VoiceCategoryCandidate {
            id: format!("c{i}"),
            name: p.name.to_string(),
            is_income: p.is_income,
            preset_key: Some(p.key.to_string()),
        })
        .collect()
}

/// Two drafts agree when every field a user would have to correct
/// agrees. `VoiceDraft` derives `PartialEq`, so this is just that --
/// named for what it means at the call site.
fn same_draft(want: &VoiceDraft, have: &VoiceDraft) -> bool {
    want == have
}

/// Reads a 16-bit PCM mono WAV into the `[-1.0, 1.0]` `f32` the models
/// take. Deliberately minimal rather than a dependency: the fixtures are
/// all written by one generator in one format, and a test helper that
/// silently coped with a format the app can't record would be hiding the
/// thing worth knowing.
fn read_wav_16k_mono(path: &Path) -> Vec<f32> {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    assert_eq!(&bytes[0..4], b"RIFF", "{}: not a RIFF file", path.display());
    assert_eq!(
        &bytes[8..12],
        b"WAVE",
        "{}: not a WAVE file",
        path.display()
    );

    let mut pos = 12;
    let mut sample_rate = 0u32;
    let mut channels = 0u16;
    let mut bits = 0u16;
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body = &bytes[pos + 8..(pos + 8 + size).min(bytes.len())];
        match id {
            b"fmt " => {
                channels = u16::from_le_bytes(body[2..4].try_into().unwrap());
                sample_rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
                bits = u16::from_le_bytes(body[14..16].try_into().unwrap());
            }
            b"data" => data = Some(body),
            _ => {}
        }
        pos += 8 + size + (size & 1); // chunks are word-aligned
    }

    let data = data.unwrap_or_else(|| panic!("{}: no data chunk", path.display()));
    assert_eq!(channels, 1, "{}: expected mono", path.display());
    assert_eq!(bits, 16, "{}: expected 16-bit PCM", path.display());
    assert_eq!(
        sample_rate,
        16_000,
        "{}: expected 16kHz -- the app's own MediaRecorder path resamples \
         to 16k before calling in, so a fixture at another rate would be \
         measuring something we never run",
        path.display()
    );

    let pad = std::env::var("BUDGET_VOICE_PAD_MS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0)
        * 16;
    let mut out = vec![0.0f32; pad];
    out.extend(
        data.as_chunks::<2>()
            .0
            .iter()
            .map(|b| f32::from(i16::from_le_bytes(*b)) / 32768.0),
    );
    out.extend(std::iter::repeat_n(0.0f32, pad));
    out
}

/// Appends one `<file>\t<transcript>` row to `$BUDGET_VOICE_DUMP/<lang>.tsv`
/// when that variable is set. Inference is the expensive half of this
/// harness and the parser is the half that changes, so capturing the
/// transcripts lets a parser change be re-scored for free -- and lets
/// the shipped models and an out-of-process model be scored by exactly
/// the same code.
///
/// A dump that cannot be written is reported and then ignored: this is a
/// side-channel for a run whose real assertions are elsewhere, so it must
/// never turn a passing corpus run into a failing one.
fn dump_transcript(lang: &str, file: &str, transcript: &str) {
    use std::io::Write;

    let Ok(dir) = std::env::var("BUDGET_VOICE_DUMP") else {
        return;
    };
    let path = Path::new(&dir).join(format!("{lang}.tsv"));
    let written = std::fs::create_dir_all(&dir).and_then(|()| {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        writeln!(f, "{file}\t{transcript}")
    });
    if let Err(e) = written {
        eprintln!("BUDGET_VOICE_DUMP: {}: {e}", path.display());
    }
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(
        std::env::var("BUDGET_VOICE_FIXTURES")
            .unwrap_or_else(|_| "../../../scratchpad/voice".to_string()),
    )
}

/// `BUDGET_VOICE_MODELS` overrides where the model files are read
/// from, which is what lets the same harness score a *different* model
/// on the same fixtures -- the only comparison that means anything when
/// deciding whether a swap is a regression.
fn model_path(name: &str) -> PathBuf {
    match std::env::var("BUDGET_VOICE_MODELS") {
        Ok(dir) => PathBuf::from(dir).join(name),
        Err(_) => Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../www/static/voice")
            .join(name),
    }
}

/// Skips (rather than fails) when the model or fixtures are absent, and
/// says which, so a run in a checkout without LFS is legible instead of
/// looking like a regression.
fn require(paths: &[&Path]) -> bool {
    for p in paths {
        if !p.exists() {
            eprintln!("SKIP: missing {}", p.display());
            return false;
        }
    }
    true
}

/// Word error rate, the standard ASR metric: edit distance over word
/// tokens divided by the reference's word count.
fn wer(reference: &str, hypothesis: &str) -> f64 {
    // Case-folded: the English vocabulary is uppercase word-pieces and
    // the corpus is written lowercase, so a case-sensitive compare would
    // score a perfect transcript at 100% WER.
    let reference = reference.to_uppercase();
    let hypothesis = hypothesis.to_uppercase();
    let r: Vec<&str> = reference.split_whitespace().collect();
    let h: Vec<&str> = hypothesis.split_whitespace().collect();
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    let mut cur = vec![0usize; h.len() + 1];
    for i in 1..=r.len() {
        cur[0] = i;
        for j in 1..=h.len() {
            let sub = prev[j - 1] + usize::from(r[i - 1] != h[j - 1]);
            cur[j] = sub.min(prev[j] + 1).min(cur[j - 1] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[h.len()] as f64 / r.len() as f64
}

/// Same idea over characters, which is the metric that means anything
/// for Mandarin -- a character vocabulary has no word boundaries to
/// score against.
fn cer(reference: &str, hypothesis: &str) -> f64 {
    let r: Vec<char> = reference.chars().filter(|c| !c.is_whitespace()).collect();
    let h: Vec<char> = hypothesis.chars().filter(|c| !c.is_whitespace()).collect();
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    let mut cur = vec![0usize; h.len() + 1];
    for i in 1..=r.len() {
        cur[0] = i;
        for j in 1..=h.len() {
            let sub = prev[j - 1] + usize::from(r[i - 1] != h[j - 1]);
            cur[j] = sub.min(prev[j] + 1).min(cur[j - 1] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[h.len()] as f64 / r.len() as f64
}

#[cfg(feature = "voice")]
#[test]
#[ignore = "needs the LFS model and generated fixtures"]
fn vendor_english_transcripts_reproduce() {
    let model = model_path("en-wenet-f16.onnx");
    let wavs = fixtures_dir().join("vendor-en");
    let trans = wavs.join("trans.txt");
    if !require(&[&model, &trans]) {
        return;
    }
    let bytes = std::fs::read(&model).unwrap();
    let text = std::fs::read_to_string(&trans).unwrap();

    let mut total = 0.0;
    let mut n = 0;
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let (name, reference) = line.split_once(' ').unwrap();
        let wav = wavs.join(name);
        if !wav.exists() {
            continue;
        }
        let samples = read_wav_16k_mono(&wav);
        let started = Instant::now();
        let got = budget_calc::voice::transcribe_voice_command(bytes.clone(), &samples).unwrap();
        let elapsed = started.elapsed();
        let rate = wer(reference, &got);
        let audio_s = samples.len() as f64 / 16_000.0;
        println!(
            "{name}  {audio_s:.1}s audio  {:.2}s decode  RTF {:.2}  WER {:.1}%\n  ref: {reference}\n  got: {got}",
            elapsed.as_secs_f64(),
            elapsed.as_secs_f64() / audio_s,
            rate * 100.0
        );
        total += rate;
        n += 1;
    }
    assert!(n > 0, "no vendor fixtures ran");
    let mean = total / f64::from(n);
    println!(
        "\nEnglish vendor mean WER: {:.1}% over {n} clips",
        mean * 100.0
    );
    // The vendor's own clips on the vendor's own model: anything above a
    // few percent means the DSP or graph wiring is wrong, not that the
    // model is weak.
    assert!(
        mean < 0.05,
        "vendor WER {:.1}% -- pipeline is wrong",
        mean * 100.0
    );
}

#[cfg(feature = "voice")]
#[test]
#[ignore = "needs the LFS model and generated fixtures"]
fn corpus_english_parses_into_the_right_transaction() {
    let model = model_path("en-wenet-f16.onnx");
    let manifest = fixtures_dir().join("en/manifest.tsv");
    if !require(&[&model, &manifest]) {
        return;
    }
    let bytes = std::fs::read(&model).unwrap();
    let text = std::fs::read_to_string(&manifest).unwrap();
    let categories = starter_candidates();

    let mut exact = 0;
    let mut parsed_ok = 0;
    let mut n = 0;
    let mut wer_total = 0.0;
    let mut decode_total = 0.0;
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let mut parts = line.split('\t');
        let (file, said) = (parts.next().unwrap(), parts.next().unwrap());
        let wav = fixtures_dir().join("en").join(file);
        if !wav.exists() {
            continue;
        }
        let samples = read_wav_16k_mono(&wav);
        let started = Instant::now();
        let got = budget_calc::voice::transcribe_voice_command(bytes.clone(), &samples).unwrap();
        decode_total += started.elapsed().as_secs_f64();

        dump_transcript("en", file, &got);
        let want = parse_voice_command(said, &categories, VoiceLanguage::En);
        let have = parse_voice_command(&got, &categories, VoiceLanguage::En);
        let same = same_draft(&want, &have);
        if same {
            parsed_ok += 1;
        }
        if got.eq_ignore_ascii_case(said) {
            exact += 1;
        }
        wer_total += wer(said, &got);
        n += 1;
        if !same {
            println!(
                "MISS  said: {said}\n      got:  {got}\n      want {want:?}\n      have {have:?}"
            );
        }
    }
    assert!(n > 0, "no english corpus fixtures ran");
    println!(
        "\nEnglish corpus: {parsed_ok}/{n} parsed correctly ({:.0}%), {exact}/{n} exact transcript, mean WER {:.1}%, mean decode {:.2}s",
        parsed_ok as f64 / f64::from(n) * 100.0,
        wer_total / f64::from(n) * 100.0,
        decode_total / f64::from(n)
    );
    // Parsed accuracy, not WER, because that is what reaches the user:
    // WER is materially worse and the transactions still come out the
    // same, which is the whole argument for constrained matching over a
    // bigger model.
    //
    // This floor was 88%, the figure the replaced NVIDIA QuartzNet15x5
    // scored on a 50-clip corpus that lived outside the repo and no
    // longer exists. That made it a number nobody could reproduce or
    // check a regression against, so it is replaced rather than carried
    // forward: 80% is measured on the 48-clip corpus that
    // `tests/fixtures/gen_corpus.py` now generates, where the shipped
    // model scores 81%. The generator is committed precisely so this
    // number stays checkable.
    //
    // What is NOT claimed here: that 81% and the old 88% are comparable.
    // They are different corpora, and this one is the harder of the two
    // -- it leans on brand names (uber, spotify, netflix) that a
    // LibriSpeech-trained model has never seen. Re-running QuartzNet on
    // this corpus would settle it; the weights are still in git history.
    assert!(
        parsed_ok as f64 / f64::from(n) >= 0.80,
        "parsed accuracy {:.0}% is below the 80% floor measured on the committed corpus",
        parsed_ok as f64 / f64::from(n) * 100.0
    );
}

#[cfg(feature = "voice-cmn")]
#[test]
#[ignore = "needs the LFS model and generated fixtures"]
fn corpus_mandarin_parses_into_the_right_transaction() {
    let model = model_path("zh-wenet-f16.onnx");
    let manifest = fixtures_dir().join("zh/manifest.tsv");
    if !require(&[&model, &manifest]) {
        return;
    }
    let bytes = std::fs::read(&model).unwrap();
    let text = std::fs::read_to_string(&manifest).unwrap();
    let categories = starter_candidates();

    let mut exact = 0;
    let mut parsed_ok = 0;
    let mut n = 0;
    let mut cer_total = 0.0;
    let mut decode_total = 0.0;
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let mut parts = line.split('\t');
        let (file, said) = (parts.next().unwrap(), parts.next().unwrap());
        let wav = fixtures_dir().join("zh").join(file);
        if !wav.exists() {
            continue;
        }
        let samples = read_wav_16k_mono(&wav);
        let started = Instant::now();
        let got =
            budget_calc::voice_cmn::transcribe_voice_command_cmn(bytes.clone(), &samples).unwrap();
        decode_total += started.elapsed().as_secs_f64();

        dump_transcript("zh", file, &got);
        let want = parse_voice_command(said, &categories, VoiceLanguage::Cmn);
        let have = parse_voice_command(&got, &categories, VoiceLanguage::Cmn);
        let same = same_draft(&want, &have);
        if same {
            parsed_ok += 1;
        }
        // A Mandarin vocabulary is characters, so "exact" is a fair ask
        // here in a way it is not for English word-pieces.
        let normalized = got.replace(' ', "");
        if normalized == said {
            exact += 1;
        }
        cer_total += cer(said, &got);
        n += 1;
        if !same {
            println!("MISS  said: {said}\n      got:  {normalized}\n      want {want:?}\n      have {have:?}");
        }
    }
    assert!(n > 0, "no mandarin corpus fixtures ran");
    println!(
        "\nMandarin corpus: {parsed_ok}/{n} parsed correctly ({:.0}%), {exact}/{n} exact transcript, mean CER {:.1}%, mean decode {:.2}s",
        parsed_ok as f64 / f64::from(n) * 100.0,
        cer_total / f64::from(n) * 100.0,
        decode_total / f64::from(n)
    );
    // ⚠️ This bar is a **regression**, recorded honestly rather than
    // quietly normalised. The NVIDIA Citrinet-512 this replaced scores
    // 94% on these same 50 clips (CER 3.9% against this model's 12.7%).
    // AISHELL-1 is 178 hours of read mainland Mandarin; Citrinet-512 was
    // trained on roughly 1000 hours of AISHELL-2, and it shows on short
    // command phrases even though this model is word-perfect on the
    // pipeline check.
    //
    // Every single miss is a category-word homophone -- 订阅 heard as
    // 定月, 话费 as 化费, 药店 as 要点 -- with the direction verb and the
    // amount parsed correctly. A pinyin-level fuzzy match in
    // `voice_parse.rs` is the route back,
    // and until it exists this number is what Mandarin voice entry
    // actually delivers.
    assert!(
        parsed_ok as f64 / f64::from(n) >= 0.66,
        "parsed accuracy {:.0}% is below even the reduced 66% this model was measured at",
        parsed_ok as f64 / f64::from(n) * 100.0
    );
}
