// Throwaway manual verification tool, not part of the test suite: loads a
// real `.rten` model and a raw f32 (16kHz mono, native-endian) sample dump
// and runs the real transcribe path end-to-end. Exists because this
// module's own unit tests only ever exercise decode logic against
// synthetic tensors -- never a real `model.run_n` call -- which is
// exactly how the "model has two inputs, only one was ever supplied" bug
// shipped to production undetected. Usage:
//   cargo run --release --features voice,voice-cmn --example e2e_check \
//     -- <en|cmn> <model.rten> <samples.f32>

// Two `main`s, because every language arm below is behind a `cfg` and
// `cargo clippy --all-targets` (what CI runs) compiles this example with
// no voice feature at all. With none of them on, the real body is a match
// whose only arm diverges: the `Result` has no type to infer and the
// printing below it is unreachable -- an error and a `-D warnings`
// failure, in a file nobody would think to check. Splitting on the cfg
// means the no-feature build compiles the stub instead.
#[cfg(not(any(feature = "voice", feature = "voice-cmn")))]
fn main() {
    panic!("build with --features voice and/or voice-cmn to use this example");
}

#[cfg(any(feature = "voice", feature = "voice-cmn"))]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let language = &args[1];
    let model_bytes = std::fs::read(&args[2]).expect("read model");
    let raw = std::fs::read(&args[3]).expect("read samples");
    let mut samples: Vec<f32> = Vec::with_capacity(raw.len() / 4);
    for i in 0..raw.len() / 4 {
        let b = &raw[i * 4..i * 4 + 4];
        samples.push(f32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    }

    let result = match language.as_str() {
        #[cfg(feature = "voice")]
        "en" => budget_calc::transcribe_voice_command(model_bytes, &samples),
        #[cfg(feature = "voice-cmn")]
        "cmn" => budget_calc::transcribe_voice_command_cmn(model_bytes, &samples),
        other => panic!("unknown or not-compiled-in language: {other}"),
    };
    match result {
        Ok(text) => println!("OK: {text:?}"),
        Err(e) => println!("ERR: {e:?}"),
    }
}
