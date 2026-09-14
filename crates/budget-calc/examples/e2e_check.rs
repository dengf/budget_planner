// Throwaway manual verification tool, not part of the test suite: loads a
// real `.rten` model and a raw f32 (16kHz mono, native-endian) sample dump
// and runs the real transcribe path end-to-end. Exists because this
// module's own unit tests only ever exercise decode logic against
// synthetic tensors -- never a real `model.run_n` call -- which is
// exactly how the "model has two inputs, only one was ever supplied" bug
// shipped to production undetected. Usage:
//   cargo run --release --features voice-cmn,voice-yue --example e2e_check \
//     -- <cmn|yue> <model.rten> <samples.f32>

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
        #[cfg(feature = "voice-cmn")]
        "cmn" => budget_calc::transcribe_voice_command_cmn(model_bytes, &samples),
        #[cfg(feature = "voice-yue")]
        "yue" => budget_calc::transcribe_voice_command_yue(model_bytes, &samples),
        other => panic!("unknown or not-compiled-in language: {other}"),
    };
    match result {
        Ok(text) => println!("OK: {text:?}"),
        Err(e) => println!("ERR: {e:?}"),
    }
}
