//! Model-agnostic pure logic for "Smart Parse" (GLM-OCR): image
//! preprocessing, chat-template construction, mrope position-id math,
//! splicing vision features into embeddings, greedy-decode bookkeeping,
//! and tokenizer encode/decode. A thin, from-scratch Rust port of
//! GLM-OCR's own inference pipeline (`modeling_glm_ocr.py`,
//! `processing_glm46v.py`, `image_processing_pil_glm46v.py` in the
//! `transformers` package this was derived from) -- not a generic
//! transformers runtime. Every magic number below (patch size, special
//! token IDs, the chat-template token sequence) is fixed to this one
//! model, confirmed against the model's own real ONNX export and
//! cross-checked byte-for-byte against its `PyTorch` reference output on
//! two test images before ever being written here. This module always
//! implements the model's "Text Recognition" task -- not "Table
//! Recognition" or a custom schema -- specifically so its output is
//! plain text that slots into the same parser every other OCR engine in
//! this app already feeds.
//!
//! Deliberately has **zero dependency on `rten`/`rten-tensor`** --
//! nothing here ever runs a model forward pass (that's
//! `smart_parse_model.rs`, gated behind a separate `smart-parse-model`
//! feature); every function operates on plain `&[f32]`/`&[i32]`/`Vec`
//! buffers. This is what lets `budget-wasm-glmocr-orchestrate` stay a
//! small, lightweight wasm module with no ML runtime compiled in at
//! all, unlike its three model-holding sibling crates -- see this
//! crate's `Cargo.toml` for the exact feature split, and
//! `www/src/ocrWorker.js` for how the orchestration loop that used to
//! live in this crate's own `SmartParseSession::run` now lives in JS
//! instead: separate wasm module instances cannot call each other
//! directly, only JS can sequence calls across them, so the top-level
//! control flow (which model to call next) had to move there. Every
//! actual calculation with a right-or-wrong answer stays here,
//! individually unit-tested, exactly as before the split.

use budget_core::BudgetError;
use image::{ImageBuffer, Rgb};
use rten_text::Tokenizer;

const PATCH_SIZE: i64 = 14;
const MERGE_SIZE: i64 = 2;
const TEMPORAL_PATCH_SIZE: i64 = 2;
const FACTOR: i64 = PATCH_SIZE * MERGE_SIZE;
const MIN_PIXELS: i64 = 112 * 112;
/// GLM-OCR's processor defaults to `... * 6144` here -- 6,144 merged
/// vision tokens, so 24,576 patches. That is not reachable on wasm32 at
/// all, and not for a memory-budget reason: the vision encoder attends
/// over the *patch* sequence, so its attention matrix is `patches^2`
/// f32s, and `Vec` refuses any allocation past `isize::MAX` bytes. At
/// 24,576 patches that matrix is 2.4GB against a 2GiB hard ceiling, so a
/// full-resolution phone photo traps with `capacity overflow` in
/// `raw_vec` before memory pressure is even the question (reproduced
/// locally at 24,120 patches -- see `smart_parse_model`'s own doc comment
/// for the crash generations that preceded this one).
///
/// Measured on this exact model, varying only the image size (wasm,
/// `simd128`, single-threaded), peak is `VisionEncoder`'s own module
/// memory and time is one `encode` call:
///
/// | patches | tokens | peak | encode |
/// |---|---|---|---|
/// | 320 | 80 | 348MB | 27.8s |
/// | 1,216 | 304 | 432MB | 107.4s |
/// | 2,392 | 598 | 549MB | 245.8s |
/// | 4,920 | 1,230 | 889MB | 711.1s |
///
/// 640 tokens (2,560 patches) is where that stops being reckless on both
/// axes: ~560MB leaves real headroom under the ~1GB a tab has actually
/// died at here, and the quadratic attention term hasn't yet taken over
/// from the linear ~0.087s/patch cost. It is *not* a comfortable number
/// -- a scan at this size is minutes, because the quantized matmul the
/// whole pipeline leans on has no wasm SIMD kernel and runs scalar (see
/// `smart_parse_model`'s own doc comment). Raise this once that is fixed,
/// against fresh measurements rather than by guessing.
const MAX_PIXELS: i64 = 14 * 14 * 2 * 2 * 2 * 640;

// OpenAI CLIP normalization constants -- this image processor's own
// `image_mean`/`image_std` defaults.
const CLIP_MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
const CLIP_STD: [f32; 3] = [0.268_629_54, 0.261_302_6, 0.275_777_1];

// GLM-OCR's own special-token ids (`generation_config.json` /
// `tokenizer_config.json`), fixed to this model.
const GMASK: i32 = 59248;
const SOP: i32 = 59250;
const USER: i32 = 59253;
const NEWLINE: i32 = 10;
const IMAGE_START: i32 = 59256;
const IMAGE_TOKEN: i32 = 59280;
const IMAGE_END: i32 = 59257;
const ASSISTANT: i32 = 59254;
const EOS: [i32; 2] = [59246, 59253];

const TASK_PROMPT: &str = "Text Recognition:";

/// Also defined in `smart_parse_model.rs` -- see that copy's own doc
/// comment for why duplicating this one `usize` across the two
/// feature-gated modules is the right tradeoff here.
pub const HIDDEN_SIZE: usize = 1536;

pub const MAX_NEW_TOKENS: usize = 800;

/// Computes the resized (height, width) GLM-OCR's processor resizes to
/// before patchifying -- rounded to a `patch_size * merge_size` (28px)
/// grid, kept within `[MIN_PIXELS, MAX_PIXELS]` total area. Ported
/// directly from `image_processing_pil_glm46v.py`'s `smart_resize`,
/// specialized to the single-image case (`num_frames == temporal_factor`
/// always, since this app never sends video).
fn smart_resize(height: i64, width: i64) -> (i64, i64) {
    let mut height = height;
    let mut width = width;
    if height < FACTOR || width < FACTOR {
        let scale = (FACTOR as f64 / height as f64).max(FACTOR as f64 / width as f64);
        height = (height as f64 * scale) as i64;
        width = (width as f64 * scale) as i64;
    }
    let mut h_bar = ((height as f64 / FACTOR as f64).round() as i64) * FACTOR;
    let mut w_bar = ((width as f64 / FACTOR as f64).round() as i64) * FACTOR;
    let t_bar = TEMPORAL_PATCH_SIZE;

    if t_bar * h_bar * w_bar > MAX_PIXELS {
        let beta = ((TEMPORAL_PATCH_SIZE as f64 * height as f64 * width as f64)
            / MAX_PIXELS as f64)
            .sqrt();
        h_bar = FACTOR.max(((height as f64 / beta / FACTOR as f64).floor() as i64) * FACTOR);
        w_bar = FACTOR.max(((width as f64 / beta / FACTOR as f64).floor() as i64) * FACTOR);
    } else if t_bar * h_bar * w_bar < MIN_PIXELS {
        let beta = (MIN_PIXELS as f64
            / (TEMPORAL_PATCH_SIZE as f64 * height as f64 * width as f64))
            .sqrt();
        h_bar = ((height as f64 * beta / FACTOR as f64).ceil() as i64) * FACTOR;
        w_bar = ((width as f64 * beta / FACTOR as f64).ceil() as i64) * FACTOR;
    }
    (h_bar, w_bar)
}

/// The vision-encoder patch grid (in `PATCH_SIZE`-sized units) a
/// `width`x`height` image resizes to, without decoding or resampling
/// any pixels -- split out from `patchify` so a caller (or
/// `build_input_ids`'s `num_image_tokens` bookkeeping, or
/// `get_rope_index`) can get `grid_h`/`grid_w` without paying for, or
/// duplicating, the resize+copy work `patchify` also does. Tuples don't
/// cross the wasm boundary, which is the other reason this is a
/// separate call rather than `patchify` returning `(Vec<f32>, i64,
/// i64)` the way this logic's pre-split predecessor did.
pub fn patch_grid(width: u32, height: u32) -> Result<(i64, i64), BudgetError> {
    if width == 0 || height == 0 {
        return Err(BudgetError::EmptyImage);
    }
    let (h_bar, w_bar) = smart_resize(height as i64, width as i64);
    Ok((h_bar / PATCH_SIZE, w_bar / PATCH_SIZE))
}

/// Resizes and patchifies a raw RGB image into GLM-OCR's expected flat
/// patch layout: one row per `(temporal_patch_size * patch_size *
/// patch_size * channels)`-element patch, rescaled to `[0, 1]` and
/// CLIP-normalized, in the exact `(merge-grid-row, merge-grid-col,
/// within-merge-row, within-merge-col)` order the vision encoder's own
/// rope position ids assume -- see `image_processing_pil_glm46v.py`'s
/// `patchify` for the numpy original this mirrors. Resampling uses the
/// `image` crate's `CatmullRom` filter rather than PIL's bicubic (no
/// bit-exact equivalent available in pure Rust); empirically this made
/// no difference to output text on either test image checked against
/// the PIL-preprocessed reference during development.
///
/// Validates the image buffer itself (this used to be `run()`'s job,
/// upstream of a `patchify` that `.expect()`-panicked on a bad buffer --
/// a latent whole-module-abort bug once `run()` stopped being the one
/// gatekeeper every caller had to go through).
pub fn patchify(rgb: &[u8], width: u32, height: u32) -> Result<Vec<f32>, BudgetError> {
    if rgb.is_empty() || width == 0 || height == 0 {
        return Err(BudgetError::EmptyImage);
    }
    if rgb.len() != (width as usize) * (height as usize) * 3 {
        return Err(BudgetError::SmartParseFailed(
            "image buffer length does not match width * height * 3".into(),
        ));
    }
    let (grid_h, grid_w) = patch_grid(width, height)?;
    let (h_bar, w_bar) = (grid_h * PATCH_SIZE, grid_w * PATCH_SIZE);

    let img: ImageBuffer<Rgb<u8>, _> = ImageBuffer::from_raw(width, height, rgb.to_vec())
        .ok_or_else(|| BudgetError::SmartParseFailed("failed to build image buffer".into()))?;
    let resized = image::imageops::resize(
        &img,
        w_bar as u32,
        h_bar as u32,
        image::imageops::FilterType::CatmullRom,
    );

    let gh = grid_h / MERGE_SIZE;
    let gw = grid_w / MERGE_SIZE;

    let mut pixel_values = Vec::with_capacity(
        (grid_h * grid_w * 3 * TEMPORAL_PATCH_SIZE * PATCH_SIZE * PATCH_SIZE) as usize,
    );
    for gh_i in 0..gh {
        for gw_i in 0..gw {
            for mh in 0..MERGE_SIZE {
                for mw in 0..MERGE_SIZE {
                    let patch_row = gh_i * MERGE_SIZE + mh;
                    let patch_col = gw_i * MERGE_SIZE + mw;
                    for c in 0..3usize {
                        for _t in 0..TEMPORAL_PATCH_SIZE {
                            for ph in 0..PATCH_SIZE {
                                for pw in 0..PATCH_SIZE {
                                    let y = (patch_row * PATCH_SIZE + ph) as u32;
                                    let x = (patch_col * PATCH_SIZE + pw) as u32;
                                    let px = resized.get_pixel(x, y);
                                    let raw = px[c] as f32 / 255.0;
                                    pixel_values.push((raw - CLIP_MEAN[c]) / CLIP_STD[c]);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(pixel_values)
}

fn load_tokenizer(tokenizer_json: &[u8]) -> Result<Tokenizer, BudgetError> {
    let tokenizer_json = std::str::from_utf8(tokenizer_json)
        .map_err(|e| BudgetError::SmartParseTokenizerLoadFailed(e.to_string()))?;
    Tokenizer::from_json(tokenizer_json)
        .map_err(|e| BudgetError::SmartParseTokenizerLoadFailed(e.to_string()))
}

/// Builds the fixed token sequence GLM-OCR's own chat template produces
/// for a single-image "Text Recognition" turn --
/// `[gMASK]<sop><|user|>\n<|begin_of_image|>{image tokens}<|end_of_image|>Text
/// Recognition:<|assistant|>\n` -- without a general Jinja2 chat-template
/// engine, since this app only ever sends this one fixed template.
/// Confirmed against the model's own tokenizer output (dumped from a
/// real `apply_chat_template` call) rather than assumed.
pub fn build_input_ids(
    tokenizer: &Tokenizer,
    num_image_tokens: usize,
) -> Result<Vec<i32>, BudgetError> {
    let task_ids = tokenizer
        .encode(TASK_PROMPT, None)
        .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;

    let mut ids = Vec::with_capacity(8 + num_image_tokens + task_ids.token_ids().len());
    ids.extend([GMASK, SOP, USER, NEWLINE, IMAGE_START]);
    ids.extend(std::iter::repeat_n(IMAGE_TOKEN, num_image_tokens));
    ids.push(IMAGE_END);
    ids.extend(task_ids.token_ids().iter().map(|&id| id as i32));
    ids.extend([ASSISTANT, NEWLINE]);
    Ok(ids)
}

/// Loads `tokenizer_json` and delegates to `build_input_ids` -- the
/// entry point the wasm orchestrate crate actually calls. Re-parses the
/// tokenizer from bytes rather than keeping a loaded `Tokenizer` as
/// cross-call wasm state: it's only needed twice per scan (here, and in
/// `decode_tokens`), so re-parsing a few-MB JSON file twice is
/// negligible next to keeping every wasm-bound function in this module
/// fully stateless.
pub fn build_input_ids_from_json(
    tokenizer_json: &[u8],
    num_image_tokens: usize,
) -> Result<Vec<i32>, BudgetError> {
    let tokenizer = load_tokenizer(tokenizer_json)?;
    build_input_ids(&tokenizer, num_image_tokens)
}

/// A numpy-to-Rust port of `GlmOcrModel.get_rope_index` (single batch
/// item, no padding): text spans get identical sequential positions on
/// all 3 mrope channels; the one image span gets a `(t, h, w)` meshgrid
/// over the merged vision grid, offset by the running position so it
/// continues, rather than restarts, the text sequence's position count.
/// Returns `(3, seq_len)` -- channel-major, matching the decoder's own
/// `position_ids` input layout.
pub fn get_rope_index(input_ids: &[i32], grid_h: i64, grid_w: i64) -> Vec<i32> {
    let llm_h = grid_h / MERGE_SIZE;
    let llm_w = grid_w / MERGE_SIZE;
    let seq_len = input_ids.len();

    let mut channels: [Vec<i32>; 3] = [
        Vec::with_capacity(seq_len),
        Vec::with_capacity(seq_len),
        Vec::with_capacity(seq_len),
    ];
    let mut current_pos: i32 = 0;
    let mut i = 0usize;
    while i < seq_len {
        if input_ids[i] == IMAGE_TOKEN {
            let start = current_pos;
            for h in 0..llm_h {
                for w in 0..llm_w {
                    channels[0].push(start);
                    channels[1].push(start + h as i32);
                    channels[2].push(start + w as i32);
                }
            }
            current_pos += llm_h.max(llm_w) as i32;
            i += (llm_h * llm_w) as usize;
        } else {
            for c in &mut channels {
                c.push(current_pos);
            }
            current_pos += 1;
            i += 1;
        }
    }

    let mut flat = Vec::with_capacity(3 * seq_len);
    for c in channels {
        flat.extend(c);
    }
    flat
}

/// Advances the channel-major `position_ids` (see `get_rope_index`) by
/// one greedy-decode step: each channel's next position is its own last
/// entry plus one. Extracted from the decode loop's own inline indexing
/// arithmetic (`pos_data[c * seq_len + seq_len - 1] + 1`) specifically
/// because that indexing has a right-or-wrong answer worth a Rust unit
/// test now that the loop itself lives in JS -- unlike appending a `1`
/// to the attention mask (nothing to get wrong there), which is left as
/// plain JS array-push.
pub fn advance_position_ids(prev_position_ids: &[i32], prev_seq_len: usize) -> [i32; 3] {
    let mut new_pos = [0i32; 3];
    for (c, slot) in new_pos.iter_mut().enumerate() {
        *slot = prev_position_ids[c * prev_seq_len + prev_seq_len - 1] + 1;
    }
    new_pos
}

/// Overwrites `embeds`'s image-token positions in place with
/// `image_features`, in prompt order -- the flat-slice equivalent of
/// `run()`'s old inline splice over `Tensor` views.
pub fn splice_image_features(
    embeds: &mut [f32],
    image_features: &[f32],
    input_ids: &[i32],
) -> Result<(), BudgetError> {
    if embeds.len() != input_ids.len() * HIDDEN_SIZE {
        return Err(BudgetError::SmartParseFailed(
            "embeddings buffer length does not match input_ids.len() * HIDDEN_SIZE".into(),
        ));
    }
    let mut img_row = 0usize;
    for (pos, &id) in input_ids.iter().enumerate() {
        if id == IMAGE_TOKEN {
            let feat_start = img_row * HIDDEN_SIZE;
            let feat_end = feat_start + HIDDEN_SIZE;
            if feat_end > image_features.len() {
                return Err(BudgetError::SmartParseFailed(
                    "image_features buffer is shorter than the number of image tokens".into(),
                ));
            }
            let dst_start = pos * HIDDEN_SIZE;
            embeds[dst_start..dst_start + HIDDEN_SIZE]
                .copy_from_slice(&image_features[feat_start..feat_end]);
            img_row += 1;
        }
    }
    Ok(())
}

pub fn argmax(values: &[f32]) -> usize {
    let mut best_i = 0;
    let mut best_v = f32::NEG_INFINITY;
    for (i, &v) in values.iter().enumerate() {
        if v > best_v {
            best_v = v;
            best_i = i;
        }
    }
    best_i
}

/// Whether `next_id` is one of GLM-OCR's own end-of-sequence token ids
/// -- kept in Rust rather than duplicated as bare numbers in
/// `ocrWorker.js`'s decode loop, same reasoning as every other magic
/// number in this module.
pub fn is_eos(next_id: i32) -> bool {
    EOS.contains(&next_id)
}

/// Decodes a generated token-id sequence back to text. The other of the
/// tokenizer's two uses per scan -- see `build_input_ids_from_json`.
pub fn decode_tokens(tokenizer_json: &[u8], generated: &[u32]) -> Result<String, BudgetError> {
    let tokenizer = load_tokenizer(tokenizer_json)?;
    tokenizer
        .decode(generated)
        .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_image_buffer_is_rejected_before_touching_the_models() {
        let err = patchify(&[], 0, 0).unwrap_err();
        assert_eq!(err, BudgetError::EmptyImage);
    }

    #[test]
    fn a_buffer_that_does_not_match_width_and_height_is_rejected() {
        let err = patchify(&[0, 0, 0], 2, 2).unwrap_err();
        assert!(matches!(err, BudgetError::SmartParseFailed(_)));
    }

    #[test]
    fn garbage_tokenizer_json_fails_to_load_rather_than_panicking() {
        let err = build_input_ids_from_json(b"not json", 1).unwrap_err();
        assert!(matches!(err, BudgetError::SmartParseTokenizerLoadFailed(_)));
    }

    #[test]
    fn smart_resize_rounds_to_the_28px_grid_and_stays_within_the_pixel_budget() {
        let (h, w) = smart_resize(864, 576);
        assert_eq!(h % FACTOR, 0);
        assert_eq!(w % FACTOR, 0);
        assert!(TEMPORAL_PATCH_SIZE * h * w >= MIN_PIXELS);
        assert!(TEMPORAL_PATCH_SIZE * h * w <= MAX_PIXELS);
    }

    #[test]
    fn patch_grid_and_patchify_agree_on_grid_dimensions() {
        let width = 56u32;
        let height = 42u32;
        let (grid_h, grid_w) = patch_grid(width, height).unwrap();
        let rgb = vec![0u8; (width as usize) * (height as usize) * 3];
        let pixel_values = patchify(&rgb, width, height).unwrap();
        let expected_len =
            (grid_h * grid_w * 3 * TEMPORAL_PATCH_SIZE * PATCH_SIZE * PATCH_SIZE) as usize;
        assert_eq!(pixel_values.len(), expected_len);
    }

    #[test]
    fn get_rope_index_advances_by_the_larger_grid_dimension_after_an_image_span() {
        // 2 text tokens, a 2x3 merged image grid (6 image tokens), 1 text token.
        let ids = [
            1,
            2,
            IMAGE_TOKEN,
            IMAGE_TOKEN,
            IMAGE_TOKEN,
            IMAGE_TOKEN,
            IMAGE_TOKEN,
            IMAGE_TOKEN,
            3,
        ];
        let flat = get_rope_index(&ids, 4, 6); // grid_h=4,grid_w=6 -> llm_h=2,llm_w=3
        let seq_len = ids.len();
        let (t, h, w) = (
            &flat[0..seq_len],
            &flat[seq_len..2 * seq_len],
            &flat[2 * seq_len..3 * seq_len],
        );
        assert_eq!(&t[0..2], &[0, 1]);
        // image span starts at position 2 on every channel's base
        assert_eq!(t[2], 2);
        assert_eq!(h[2], 2);
        assert_eq!(w[2], 2);
        // last image token: t stays at the image start, h/w reach their max offset
        assert_eq!(t[7], 2);
        assert_eq!(h[7], 2 + 1);
        assert_eq!(w[7], 2 + 2);
        // trailing text token continues after max(llm_h, llm_w) = 3
        assert_eq!(t[8], 2 + 3);
        assert_eq!(h[8], 2 + 3);
        assert_eq!(w[8], 2 + 3);
    }

    #[test]
    fn advance_position_ids_adds_one_on_every_channel() {
        // seq_len=2, channels [ [0,1], [10,11], [20,21] ] flattened channel-major.
        let flat = [0, 1, 10, 11, 20, 21];
        let next = advance_position_ids(&flat, 2);
        assert_eq!(next, [2, 12, 22]);
    }

    #[test]
    fn is_eos_matches_only_the_known_end_of_sequence_ids() {
        assert!(is_eos(EOS[0]));
        assert!(is_eos(EOS[1]));
        assert!(!is_eos(0));
    }

    #[test]
    fn splice_image_features_overwrites_only_image_token_positions() {
        let input_ids = [1, IMAGE_TOKEN, 2];
        let mut embeds = vec![0.0f32; input_ids.len() * HIDDEN_SIZE];
        embeds[0] = 9.0; // text position, must survive untouched
        let image_features = vec![1.0f32; HIDDEN_SIZE];
        splice_image_features(&mut embeds, &image_features, &input_ids).unwrap();
        assert_eq!(embeds[0], 9.0);
        assert_eq!(
            &embeds[HIDDEN_SIZE..2 * HIDDEN_SIZE],
            image_features.as_slice()
        );
        assert_eq!(embeds[2 * HIDDEN_SIZE], 0.0);
    }
}
