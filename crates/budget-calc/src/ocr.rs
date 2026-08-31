//! OCR over a raw pixel buffer, using `ocrs-cjk`/`rten` -- a pure-Rust
//! engine that compiles to `wasm32-unknown-unknown`, chosen deliberately
//! over a JS OCR library so the actual decision (what does this image
//! say) stays in the same crate as every other rule in this app rather
//! than crossing into a black-box npm dependency. See the receipt-capture
//! plan addendum for why, and for the one place (rasterizing a scanned
//! PDF page to pixels) that genuinely has no pure-Rust answer and is out
//! of scope for v1 instead of reached for in JS.
//!
//! Model files have no filesystem to live on inside wasm, so both the
//! model bytes and the image bytes arrive as plain buffers already read
//! by the host layer (`www`'s `fetch`/canvas calls) -- this module never
//! reads a path or hits the network itself.
//!
//! Runs PP-OCRv6_tiny (det + rec), not `ocrs`'s original English-only
//! models -- swapped in because the original models have no way to
//! represent CJK text at all, and because a hands-on spike (photographed
//! receipt, not a stylized test image) showed PP-OCRv6_tiny reads a
//! receipt's item/price layout more reliably even in English. The
//! recognition model's own character dictionary is embedded at compile
//! time (`ALPHABET_JSON` below) rather than passed in from JS, since it's
//! fixed per model, not something a caller could meaningfully vary.
//! Critical, non-obvious detail: this dictionary must come from the
//! model's own `inference.yml` (`PostProcess.character_dict`, plus a
//! trailing space -- PaddleOCR's `CTCLabelDecode` defaults
//! `use_space_char` to true even when the yml doesn't mention it) in
//! exact training order. `ocrs_cjk::cjk_alphabet()`, the crate's own
//! convenience helper, builds its alphabet by walking Unicode codepoint
//! ranges in numeric order -- a different order from any real PP-OCR
//! training dictionary -- and silently produces garbled text rather than
//! an error if used here.

use budget_core::BudgetError;
use ocrs_cjk::{ImageSource, OcrEngine, OcrEngineParams};
use rten::Model;

const ALPHABET_JSON: &str = include_str!("../assets/ppocrv6_tiny_alphabet.json");

fn alphabet() -> String {
    serde_json::from_str(ALPHABET_JSON).expect("ppocrv6_tiny_alphabet.json is a valid JSON string")
}

/// Runs OCR over an RGB image buffer (`width * height * 3` bytes, no
/// alpha channel -- the caller strips it, since neither the detection
/// nor recognition model uses it) and returns whatever text was found,
/// in reading order, as `ocrs_cjk::OcrEngine::get_text` produces it.
pub fn run_ocr(
    detection_model_bytes: Vec<u8>,
    recognition_model_bytes: Vec<u8>,
    image_rgb: &[u8],
    width: u32,
    height: u32,
) -> Result<String, BudgetError> {
    if image_rgb.is_empty() {
        return Err(BudgetError::EmptyImage);
    }

    let detection_model = Model::load(detection_model_bytes)
        .map_err(|e| BudgetError::OcrModelLoadFailed(e.to_string()))?;
    let recognition_model = Model::load(recognition_model_bytes)
        .map_err(|e| BudgetError::OcrModelLoadFailed(e.to_string()))?;

    let engine = OcrEngine::new(OcrEngineParams {
        detection_model: Some(detection_model),
        recognition_model: Some(recognition_model),
        alphabet: Some(alphabet()),
        ..Default::default()
    })
    .map_err(|e| BudgetError::OcrModelLoadFailed(e.to_string()))?;

    let source = ImageSource::from_bytes(image_rgb, (width, height))
        .map_err(|e| BudgetError::OcrFailed(e.to_string()))?;
    let input = engine
        .prepare_input(source)
        .map_err(|e| BudgetError::OcrFailed(e.to_string()))?;

    engine
        .get_text(&input)
        .map_err(|e| BudgetError::OcrFailed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_image_buffer_is_rejected_before_touching_the_models() {
        let err = run_ocr(vec![], vec![], &[], 0, 0).unwrap_err();
        assert_eq!(err, BudgetError::EmptyImage);
    }

    #[test]
    fn garbage_model_bytes_fail_to_load_rather_than_panicking() {
        let pixel = [255u8, 255, 255];
        let err = run_ocr(
            b"not a model".to_vec(),
            b"not a model".to_vec(),
            &pixel,
            1,
            1,
        )
        .unwrap_err();
        assert!(matches!(err, BudgetError::OcrModelLoadFailed(_)));
    }

    #[test]
    fn the_embedded_alphabet_matches_ppocrv6_tiny_recs_own_dictionary_size() {
        // 6904 characters from the model's inference.yml character_dict,
        // plus the trailing space CTCLabelDecode adds by default -- see
        // this module's doc comment. A wrong count here means the asset
        // was regenerated from a different model without updating this
        // guard, which would otherwise fail silently as garbled text.
        assert_eq!(alphabet().chars().count(), 6905);
    }
}
