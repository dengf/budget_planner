//! "Smart Parse": reads a photographed receipt or bank statement with
//! `zai-org/GLM-OCR` (0.9B params, a vision-language model, not a plain
//! OCR engine) instead of `ocr.rs`'s PP-OCRv6_tiny, and hands back plain
//! text through the exact same downstream contract `run_ocr` does --
//! `ReceiptCapture.jsx` feeds this module's output into the same
//! `parse_receipt_text`/`parse_statement_text` heuristics either engine's
//! output already goes through, unchanged.
//!
//! Why a second OCR engine instead of replacing the first: PP-OCRv6_tiny
//! is a ~6MB, fast, always-available local model; GLM-OCR is a much
//! larger, much more accurate vision-language model whose fp16 ONNX
//! export is ~2.2GB across three files (vision encoder, token embedder,
//! decoder) -- too large to vendor in git or download by default. It is
//! opt-in, user-triggered, and fetched once from Hugging Face at runtime
//! (see `www/src/ocrWorker.js`'s own doc comment for the hosting
//! tradeoff this accepts). `resolve_statement_amount`'s original failure
//! mode -- a heuristic date/amount parser breaking on an unanticipated
//! statement layout -- often traces back to garbled OCR text, not just
//! parser gaps; a stronger OCR engine reduces that at the source instead
//! of trying to special-case every layout the parser sees.
//!
//! A thin, from-scratch Rust port of GLM-OCR's own inference pipeline
//! (`modeling_glm_ocr.py`, `processing_glm46v.py`, and
//! `image_processing_pil_glm46v.py` in the `transformers` package this
//! was derived from) -- not a generic transformers runtime. Every magic
//! number below (patch size, special token IDs, the chat-template
//! token sequence) is fixed to this one model, confirmed against the
//! model's own real ONNX export and cross-checked byte-for-byte against
//! its PyTorch reference output on two test images before ever being
//! written here. This module always uses the model's "Text Recognition"
//! task -- not "Table Recognition" or a custom schema -- specifically so
//! its output is plain text that slots into the same parser every other
//! OCR engine in this app already feeds, rather than inventing a second,
//! separate structured-extraction pipeline to parse and maintain.
//!
//! Model, tokenizer and image bytes all arrive as plain buffers, same
//! reason as `ocr.rs`/`embed_classify.rs`: no filesystem inside wasm.
//! Each ONNX file crosses the wasm boundary as two buffers -- the graph
//! and its external-data weights file -- loaded via
//! `rten_embed::ModelOptions::external_data` rather than
//! `Model::load_file`, since `load_file` needs a real filesystem path to
//! resolve the external-data reference against and wasm has none. The
//! external-data key passed to `.external_data()` must match the literal
//! filename GLM-OCR's own ONNX export embeds inside the graph
//! (`vision_encoder_fp16.onnx_data` etc.) -- confirmed by trial against
//! the real exported files, not guessed.

use budget_core::BudgetError;
use image::{ImageBuffer, Rgb};
use rten_embed::{Model, ModelOptions, NodeId};
use rten_tensor::prelude::*;
use rten_tensor::Tensor;
use rten_text::Tokenizer;

// -- Image preprocessing: a Rust port of `Glm46VImageProcessorPil`'s
// `smart_resize`/`patchify` (Qwen2-VL-style dynamic resolution). --

const PATCH_SIZE: i64 = 14;
const MERGE_SIZE: i64 = 2;
const TEMPORAL_PATCH_SIZE: i64 = 2;
const FACTOR: i64 = PATCH_SIZE * MERGE_SIZE;
const MIN_PIXELS: i64 = 112 * 112;
const MAX_PIXELS: i64 = 14 * 14 * 2 * 2 * 2 * 6144;

// OpenAI CLIP normalization constants -- this image processor's own
// `image_mean`/`image_std` defaults.
const CLIP_MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
const CLIP_STD: [f32; 3] = [0.268_629_54, 0.261_302_6, 0.275_777_1];

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
fn patchify(rgb: &[u8], width: u32, height: u32) -> (Vec<f32>, i64, i64) {
    let (h_bar, w_bar) = smart_resize(height as i64, width as i64);
    let img: ImageBuffer<Rgb<u8>, _> = ImageBuffer::from_raw(width, height, rgb.to_vec())
        .expect("image_rgb length must be width * height * 3");
    let resized = image::imageops::resize(
        &img,
        w_bar as u32,
        h_bar as u32,
        image::imageops::FilterType::CatmullRom,
    );

    let grid_h = h_bar / PATCH_SIZE;
    let grid_w = w_bar / PATCH_SIZE;
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
    (pixel_values, grid_h, grid_w)
}

// -- Chat template + mrope position ids --

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

const NUM_LAYERS: usize = 16;
const NUM_KV_HEADS: usize = 8;
const HEAD_DIM: usize = 128;
const HIDDEN_SIZE: usize = 1536;
const MAX_NEW_TOKENS: usize = 800;

/// Builds the fixed token sequence GLM-OCR's own chat template produces
/// for a single-image "Text Recognition" turn --
/// `[gMASK]<sop><|user|>\n<|begin_of_image|>{image tokens}<|end_of_image|>Text
/// Recognition:<|assistant|>\n` -- without a general Jinja2 chat-template
/// engine, since this app only ever sends this one fixed template.
/// Confirmed against the model's own tokenizer output (dumped from a
/// real `apply_chat_template` call) rather than assumed.
fn build_input_ids(
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

/// A numpy-to-Rust port of `GlmOcrModel.get_rope_index` (single batch
/// item, no padding): text spans get identical sequential positions on
/// all 3 mrope channels; the one image span gets a `(t, h, w)` meshgrid
/// over the merged vision grid, offset by the running position so it
/// continues, rather than restarts, the text sequence's position count.
/// Returns `(3, seq_len)` -- channel-major, matching the decoder's own
/// `position_ids` input layout.
fn get_rope_index(input_ids: &[i32], grid_h: i64, grid_w: i64) -> Vec<i32> {
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
            for c in channels.iter_mut() {
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

// -- Model loading + forward passes --

struct LoadedModel {
    model: Model,
}

impl LoadedModel {
    fn load(
        graph: Vec<u8>,
        external_data_name: &str,
        external_data: Vec<u8>,
    ) -> Result<Self, BudgetError> {
        let model = ModelOptions::with_all_ops()
            .external_data(external_data_name, external_data)
            .load(graph)
            .map_err(|e| BudgetError::SmartParseModelLoadFailed(e.to_string()))?;
        Ok(Self { model })
    }

    fn node(&self, name: &str) -> Result<NodeId, BudgetError> {
        self.model
            .node_id(name)
            .map_err(|e| BudgetError::SmartParseModelLoadFailed(e.to_string()))
    }
}

fn zero_past(batch: usize) -> Vec<(Tensor<f32>, Tensor<f32>)> {
    (0..NUM_LAYERS)
        .map(|_| {
            (
                Tensor::<f32>::from_data(&[batch, NUM_KV_HEADS, 0, HEAD_DIM], vec![]),
                Tensor::<f32>::from_data(&[batch, NUM_KV_HEADS, 0, HEAD_DIM], vec![]),
            )
        })
        .collect()
}

/// Runs GLM-OCR's full text-recognition pipeline over one image: resize
/// + patchify, vision encoder, chat-template + mrope position ids, token
///   embedding (with image features spliced into the image-token
///   positions), then a greedy-decoded, KV-cached generation loop until
///   end-of-sequence or `MAX_NEW_TOKENS`.
#[allow(clippy::too_many_arguments)]
pub fn run_smart_parse(
    vision_graph: Vec<u8>,
    vision_data: Vec<u8>,
    embed_graph: Vec<u8>,
    embed_data: Vec<u8>,
    decoder_graph: Vec<u8>,
    decoder_data: Vec<u8>,
    tokenizer_json: &[u8],
    image_rgb: &[u8],
    width: u32,
    height: u32,
) -> Result<String, BudgetError> {
    if image_rgb.is_empty() || width == 0 || height == 0 {
        return Err(BudgetError::EmptyImage);
    }
    if image_rgb.len() != (width as usize) * (height as usize) * 3 {
        return Err(BudgetError::SmartParseFailed(
            "image buffer length does not match width * height * 3".into(),
        ));
    }

    let tokenizer_json = std::str::from_utf8(tokenizer_json)
        .map_err(|e| BudgetError::SmartParseTokenizerLoadFailed(e.to_string()))?;
    let tokenizer = Tokenizer::from_json(tokenizer_json)
        .map_err(|e| BudgetError::SmartParseTokenizerLoadFailed(e.to_string()))?;

    let vision = LoadedModel::load(vision_graph, "vision_encoder_fp16.onnx_data", vision_data)?;
    let embed = LoadedModel::load(embed_graph, "embed_tokens_fp16.onnx_data", embed_data)?;
    let decoder = LoadedModel::load(
        decoder_graph,
        "decoder_model_merged_fp16.onnx_data",
        decoder_data,
    )?;

    // -- vision encoder --
    let (pixel_values, grid_h, grid_w) = patchify(image_rgb, width, height);
    let num_patches = (grid_h * grid_w) as usize;
    let pixel_tensor = Tensor::from_data(&[num_patches, 1176], pixel_values);
    let grid_tensor = Tensor::from_data(&[1, 3], vec![1i32, grid_h as i32, grid_w as i32]);

    let [image_features_val] = vision
        .model
        .run_n(
            vec![
                (vision.node("pixel_values")?, pixel_tensor.into()),
                (vision.node("image_grid_thw")?, grid_tensor.into()),
            ],
            [vision.model.output_ids()[0]],
            None,
        )
        .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;
    let image_features: Tensor<f32> = image_features_val.try_into().map_err(|_| {
        BudgetError::SmartParseFailed("unexpected vision encoder output shape".into())
    })?;
    let num_image_tokens = image_features.shape()[0];

    // -- chat template + mrope position ids --
    let input_ids = build_input_ids(&tokenizer, num_image_tokens)?;
    let seq_len = input_ids.len();
    let position_ids_flat = get_rope_index(&input_ids, grid_h, grid_w);

    // -- token embedding, with image features spliced into image-token positions --
    let embed_in = embed.node("input_ids")?;
    let embed_out = embed.model.output_ids()[0];
    let ids_tensor = Tensor::from_data(&[1, seq_len], input_ids.clone());
    let [embeds_val] = embed
        .model
        .run_n(vec![(embed_in, ids_tensor.into())], [embed_out], None)
        .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;
    let mut embeds: Tensor<f32> = embeds_val
        .try_into()
        .map_err(|_| BudgetError::SmartParseFailed("unexpected embedding output shape".into()))?;
    {
        let feat_data = image_features.data().ok_or_else(|| {
            BudgetError::SmartParseFailed("vision encoder output is not contiguous".into())
        })?;
        let data = embeds.data_mut().ok_or_else(|| {
            BudgetError::SmartParseFailed("embedding output is not contiguous".into())
        })?;
        let mut img_row = 0usize;
        for (pos, &id) in input_ids.iter().enumerate() {
            if id == IMAGE_TOKEN {
                let dst = &mut data[pos * HIDDEN_SIZE..(pos + 1) * HIDDEN_SIZE];
                let src = &feat_data[img_row * HIDDEN_SIZE..(img_row + 1) * HIDDEN_SIZE];
                dst.copy_from_slice(src);
                img_row += 1;
            }
        }
    }

    // -- greedy, KV-cached decode loop --
    let logits_id = decoder.node("logits")?;
    let mut present_ids = Vec::with_capacity(2 * NUM_LAYERS);
    for i in 0..NUM_LAYERS {
        present_ids.push(decoder.node(&format!("present.{i}.key"))?);
        present_ids.push(decoder.node(&format!("present.{i}.value"))?);
    }
    let inputs_embeds_id = decoder.node("inputs_embeds")?;
    let attention_mask_id = decoder.node("attention_mask")?;
    let position_ids_id = decoder.node("position_ids")?;
    let num_logits_to_keep_id = decoder.node("num_logits_to_keep")?;
    let mut past_key_value_ids = Vec::with_capacity(2 * NUM_LAYERS);
    for i in 0..NUM_LAYERS {
        past_key_value_ids.push((
            decoder.node(&format!("past_key_values.{i}.key"))?,
            decoder.node(&format!("past_key_values.{i}.value"))?,
        ));
    }

    let mut cur_embeds = embeds.into_shape([1, seq_len, HIDDEN_SIZE].as_slice());
    let mut cur_seq_len = seq_len;
    let mut pos_data = position_ids_flat;
    let mut attn_mask_data = vec![1i32; seq_len];
    let mut past = zero_past(1);

    let mut generated: Vec<u32> = Vec::new();
    for _ in 0..MAX_NEW_TOKENS {
        let pos_tensor = Tensor::from_data(&[3, 1, cur_seq_len], pos_data.clone());
        let attn_tensor = Tensor::from_data(&[1, attn_mask_data.len()], attn_mask_data.clone());
        let ntk = Tensor::from_data(&[] as &[usize], vec![1i32]);

        let mut inputs: Vec<(NodeId, rten_embed::ValueOrView)> = vec![
            (inputs_embeds_id, cur_embeds.clone().into()),
            (attention_mask_id, attn_tensor.into()),
            (position_ids_id, pos_tensor.into()),
            (num_logits_to_keep_id, ntk.into()),
        ];
        for (i, (k, v)) in past.iter().enumerate() {
            inputs.push((past_key_value_ids[i].0, k.clone().into()));
            inputs.push((past_key_value_ids[i].1, v.clone().into()));
        }

        let mut output_ids = vec![logits_id];
        output_ids.extend(present_ids.iter().copied());
        let outputs = decoder
            .model
            .run(inputs, &output_ids, None)
            .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;

        let logits: Tensor<f32> = outputs[0]
            .clone()
            .try_into()
            .map_err(|_| BudgetError::SmartParseFailed("unexpected decoder output shape".into()))?;
        let logits_data = logits.data().ok_or_else(|| {
            BudgetError::SmartParseFailed("decoder logits are not contiguous".into())
        })?;
        let next_id = argmax(logits_data) as i32;

        if EOS.contains(&next_id) {
            break;
        }
        generated.push(next_id as u32);

        for i in 0..NUM_LAYERS {
            let k: Tensor<f32> = outputs[1 + 2 * i].clone().try_into().map_err(|_| {
                BudgetError::SmartParseFailed("unexpected present.key shape".into())
            })?;
            let v: Tensor<f32> = outputs[2 + 2 * i].clone().try_into().map_err(|_| {
                BudgetError::SmartParseFailed("unexpected present.value shape".into())
            })?;
            past[i] = (k, v);
        }

        let next_ids_tensor = Tensor::from_data(&[1, 1], vec![next_id]);
        let [next_embed_val] = embed
            .model
            .run_n(vec![(embed_in, next_ids_tensor.into())], [embed_out], None)
            .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;
        cur_embeds = next_embed_val.try_into().map_err(|_| {
            BudgetError::SmartParseFailed("unexpected embedding output shape".into())
        })?;

        let mut new_pos = Vec::with_capacity(3);
        for c in 0..3 {
            new_pos.push(pos_data[c * cur_seq_len + cur_seq_len - 1] + 1);
        }
        pos_data = new_pos;
        cur_seq_len = 1;
        attn_mask_data.push(1);
    }

    tokenizer
        .decode(&generated)
        .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))
}

fn argmax(values: &[f32]) -> usize {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_image_buffer_is_rejected_before_touching_the_models() {
        let err = run_smart_parse(
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
            b"{}",
            &[],
            0,
            0,
        )
        .unwrap_err();
        assert_eq!(err, BudgetError::EmptyImage);
    }

    #[test]
    fn a_buffer_that_does_not_match_width_and_height_is_rejected() {
        let err = run_smart_parse(
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
            b"{}",
            &[0, 0, 0],
            2,
            2,
        )
        .unwrap_err();
        assert!(matches!(err, BudgetError::SmartParseFailed(_)));
    }

    #[test]
    fn garbage_tokenizer_json_fails_to_load_rather_than_panicking() {
        let pixel = vec![0u8; 3];
        let err = run_smart_parse(
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
            vec![],
            b"not json",
            &pixel,
            1,
            1,
        )
        .unwrap_err();
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
}
