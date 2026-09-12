//! GLM-OCR model-loading and forward-pass primitives for "Smart Parse".
//!
//! Deliberately split out from the model-agnostic orchestration logic in
//! `smart_parse_orchestrate.rs` -- see that module's own doc comment, and
//! the three sibling `budget-wasm-glmocr-{vision,embed,decoder}` crates
//! this one is bridged into, for why: `rten` (aliased `rten-embed`, see
//! this crate's `Cargo.toml`) doesn't support fp16 natively and eagerly
//! converts every weight tensor to a freshly-allocated f32 buffer at
//! load time, roughly doubling each model's resident memory over its
//! on-disk fp16 size. GLM-OCR's three ONNX files (vision encoder, token
//! embedder, decoder) sharing one wasm32 linear memory therefore
//! exceeded wasm32's hard 4GiB ceiling by construction, not as an edge
//! case -- confirmed by a real iPhone crash report (a SIGSEGV in
//! WebKit/JSC's GC, triggered from a `memory.grow()` call landing
//! exactly at the 4GiB boundary). Giving each model its own wasm module
//! instance (own linear memory) means no single wasm32 address space
//! ever needs to hold more than one model's doubled footprint at once.
//!
//! Splitting into separate wasm modules fixed the 4GiB *address-space*
//! ceiling, but a second, lower ceiling remained: real iOS Safari tabs
//! were still trapping (`unreachable`, confirmed via direct wasm binary
//! inspection to be a genuine `memory.grow()` refusal, not a declared
//! max) around ~1.1GiB of *actual* per-tab memory pressure -- the
//! decoder's own fp16-doubled footprint alone. `DecoderSession::finish`
//! below therefore loads GLM-OCR's 4-bit-quantized (`MatMulNBits`)
//! decoder export instead of the fp16 one `VisionEncoder`/`TokenEmbedder`
//! still use: its weights are native `u8` blocks that `rten`'s
//! `MatMulNBits` operator reads directly, never upconverted to f32 the
//! way every other weight tensor here is, cutting the decoder's resident
//! footprint roughly 6x (measured: ~373MB on-disk/resident quantized vs.
//! ~1.16GB on-disk -> ~2.16GB resident fp16). See this crate's
//! `Cargo.toml` for why this requires an unreleased `rten` commit rather
//! than 0.26.0.
//!
//! A real device (iPhone 17, Safari) still crashed after the decoder fix
//! landed, but with no catchable error at all this time -- a checkpoint
//! written just before the trap (see `www/src/receiptFailureBreadcrumb.js`'s
//! own doc comment for that mechanism) showed the decoder's *own* module
//! memory at a small, unremarkable ~389MB, ruling the decoder back out as
//! the direct cause. Suspicion fell on `TokenEmbedder`, the other model
//! sharing `ocrWorker.js`'s single OS process with the decoder: it still
//! loaded its fp16 export through `rten`, doubling its ~174MB on-disk size
//! to ~348MB resident, on top of whatever the decoder had grown to by
//! then. GLM-OCR does publish a quantized `embed_tokens` export, but it
//! uses `GatherBlockQuantized`, a `com.microsoft` ONNX operator `rten` has
//! no implementation of anywhere in its codebase (confirmed by grepping
//! rten's own source, not just a disabled feature flag) -- unlike the
//! decoder's `MatMulNBits`, this is not a gap the same patched-`rten`
//! approach can close.
//!
//! `TokenEmbedder` doesn't go through `rten` at all, though, avoiding the
//! problem rather than working around it: its ONNX graph is nothing more
//! than a `Gather` over one weight tensor followed by a `Cast` to f32 --
//! an embedding table lookup, not a real computation graph. `finish`
//! below keeps the raw fp16 bytes exactly as downloaded and `embed`
//! decodes only the rows a given call actually asks for, so this model's
//! resident memory is its on-disk fp16 size, not double it -- the same
//! "don't upconvert what you don't have to" principle as the decoder's
//! quantized export, just implemented by hand instead of via an ONNX
//! operator, because this graph is simple enough not to need one.
//!
//! `VisionEncoder`/`TokenEmbedder` are stateless per call (aside from
//! the loaded model itself); `DecoderSession` is not -- it holds
//! `past_key_values` as internal state across `step` calls, growing
//! every generation step, specifically so that state never has to
//! round-trip through the wasm boundary (both slow and a return of the
//! same large-buffer pattern this split exists to eliminate). See
//! `DecoderSession::step`'s own doc comment for the `reset()` contract
//! this implies.

use budget_core::BudgetError;
use rten_embed::{Model, ModelOptions, NodeId};
use rten_tensor::prelude::*;
use rten_tensor::Tensor;

/// Also defined in `smart_parse_orchestrate.rs`, which must have zero
/// dependency on `rten`/`rten-tensor` (see that module's own doc
/// comment) and so cannot import this one. A single `usize` constant
/// duplicated across two feature-gated modules of the same crate is
/// cheap and safe -- there is no way for the two to silently drift
/// without both call sites (splicing image features there, tensor
/// shapes here) breaking loudly first.
pub const HIDDEN_SIZE: usize = 1536;

const NUM_LAYERS: usize = 16;
const NUM_KV_HEADS: usize = 8;
const HEAD_DIM: usize = 128;

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

struct VisionNodes {
    pixel_values: NodeId,
    image_grid_thw: NodeId,
    output: NodeId,
}

/// GLM-OCR's vision encoder: patchified pixels + grid dims in, one flat
/// image-feature buffer out. Loaded incrementally the same way as every
/// other lazy wasm model in this app -- `begin_data`/`append_data_chunk`
/// reserve and fill an external-data buffer tens-of-MB at a time, tens
/// of times, rather than ever holding the whole ~800MB-to-1GB-scale file
/// as one buffer crossing a call boundary.
#[derive(Default)]
pub struct VisionEncoder {
    model: Option<LoadedModel>,
    nodes: Option<VisionNodes>,
    staging: Vec<u8>,
}

impl VisionEncoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_data(&mut self, total_len: usize) {
        self.staging = Vec::with_capacity(total_len);
    }

    pub fn append_data_chunk(&mut self, chunk: &[u8]) {
        self.staging.extend_from_slice(chunk);
    }

    /// Finishes loading and resolves every `NodeId` this model needs up
    /// front, once -- `encode` runs exactly once per scan, but caching
    /// here rather than inside `encode` keeps the same discipline as
    /// `TokenEmbedder`/`DecoderSession`, where it matters far more (see
    /// their own doc comments).
    pub fn finish(&mut self, graph: Vec<u8>) -> Result<(), BudgetError> {
        let data = std::mem::take(&mut self.staging);
        let model = LoadedModel::load(graph, "vision_encoder_fp16.onnx_data", data)?;
        let nodes = VisionNodes {
            pixel_values: model.node("pixel_values")?,
            image_grid_thw: model.node("image_grid_thw")?,
            output: model.model.output_ids()[0],
        };
        self.model = Some(model);
        self.nodes = Some(nodes);
        Ok(())
    }

    /// Runs the vision encoder over one image's patchified pixel values,
    /// returning a flat `[num_image_tokens * HIDDEN_SIZE]` buffer --
    /// `num_image_tokens` is recoverable by the caller as
    /// `returned.len() / HIDDEN_SIZE`, so it doesn't cross the boundary
    /// as a separate value.
    pub fn encode(
        &self,
        pixel_values: &[f32],
        grid_h: i64,
        grid_w: i64,
    ) -> Result<Vec<f32>, BudgetError> {
        let model = self.model.as_ref().ok_or_else(|| {
            BudgetError::SmartParseModelLoadFailed("vision model not loaded".into())
        })?;
        let nodes = self
            .nodes
            .as_ref()
            .expect("nodes set alongside model in finish()");

        let num_patches = pixel_values.len() / 1176;
        let pixel_tensor = Tensor::from_data(&[num_patches, 1176], pixel_values.to_vec());
        let grid_tensor = Tensor::from_data(&[1, 3], vec![1i32, grid_h as i32, grid_w as i32]);

        let [image_features_val] = model
            .model
            .run_n(
                vec![
                    (nodes.pixel_values, pixel_tensor.into()),
                    (nodes.image_grid_thw, grid_tensor.into()),
                ],
                [nodes.output],
                None,
            )
            .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;
        let image_features: Tensor<f32> = image_features_val.try_into().map_err(|_| {
            BudgetError::SmartParseFailed("unexpected vision encoder output shape".into())
        })?;
        image_features.data().map(|d| d.to_vec()).ok_or_else(|| {
            BudgetError::SmartParseFailed("vision encoder output is not contiguous".into())
        })
    }
}

/// Converts one fp16 value (as its raw bit pattern) to f32.
///
/// `rten` isn't in the picture for `TokenEmbedder` (see this module's own
/// doc comment), so there's no borrowed conversion routine to call into --
/// this is the same well-known bit-manipulation algorithm rten's own
/// `rten-base::half::f16_to_f32` uses internally, credited there as
/// "copied from the `half` crate" (<https://github.com/VoidStarKat/half-rs>).
/// Copied here rather than depending on `rten-base` directly, since it's
/// small, self-contained, and not part of any crate this workspace already
/// depends on for its own sake.
fn f16_to_f32(bits: u16) -> f32 {
    if bits & 0x7FFF == 0 {
        return f32::from_bits((bits as u32) << 16);
    }
    let sign = (bits & 0x8000) as u32;
    let exp = (bits & 0x7C00) as u32;
    let man = (bits & 0x03FF) as u32;

    if exp == 0x7C00 {
        return if man == 0 {
            f32::from_bits((sign << 16) | 0x7F80_0000)
        } else {
            f32::from_bits((sign << 16) | 0x7FC0_0000 | (man << 13))
        };
    }

    if exp == 0 {
        // Subnormal: normalize by shifting until the implicit leading bit
        // would land, adjusting the exponent to match.
        let e = (man as u16).leading_zeros() - 6;
        let out_exp = (127 - 15 - e) << 23;
        let out_man = (man << (14 + e)) & 0x7F_FFFF;
        return f32::from_bits((sign << 16) | out_exp | out_man);
    }

    let unbiased_exp = ((exp as i32) >> 10) - 15;
    let out_exp = ((unbiased_exp + 127) as u32) << 23;
    let out_man = man << 13;
    f32::from_bits((sign << 16) | out_exp | out_man)
}

/// GLM-OCR's token embedder: token ids in, one flat embedding buffer
/// out. Called once for the whole initial prompt and once per generated
/// token thereafter (up to `smart_parse_orchestrate::MAX_NEW_TOKENS`
/// times).
///
/// Unlike `VisionEncoder`/`DecoderSession`, this holds no `rten` model at
/// all -- just the raw fp16 weight table exactly as downloaded (see this
/// module's own doc comment for why bypassing `rten` here is possible and
/// worthwhile). `weights` is `[vocab_size * HIDDEN_SIZE]` fp16 values,
/// row-major by token id, matching GLM-OCR's `embed_tokens_fp16.onnx_data`
/// external-data layout exactly -- there is no ONNX graph left to parse,
/// so `finish` takes no graph argument.
#[derive(Default)]
pub struct TokenEmbedder {
    weights: Vec<u8>,
    staging: Vec<u8>,
}

impl TokenEmbedder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_data(&mut self, total_len: usize) {
        self.staging = Vec::with_capacity(total_len);
    }

    pub fn append_data_chunk(&mut self, chunk: &[u8]) {
        self.staging.extend_from_slice(chunk);
    }

    pub fn finish(&mut self) -> Result<(), BudgetError> {
        let data = std::mem::take(&mut self.staging);
        if !data.len().is_multiple_of(HIDDEN_SIZE * 2) {
            return Err(BudgetError::SmartParseModelLoadFailed(
                "embed_tokens weight file size is not a whole number of rows".into(),
            ));
        }
        self.weights = data;
        Ok(())
    }

    /// Embeds `input_ids` (the whole prompt, or a single next-token id),
    /// returning a flat `[input_ids.len() * HIDDEN_SIZE]` buffer. Each id
    /// only ever touches its own `HIDDEN_SIZE`-row slice of `weights` --
    /// nothing here ever materializes the whole table as f32.
    pub fn embed(&self, input_ids: &[i32]) -> Result<Vec<f32>, BudgetError> {
        if self.weights.is_empty() {
            return Err(BudgetError::SmartParseModelLoadFailed(
                "embed model not loaded".into(),
            ));
        }
        let vocab_size = self.weights.len() / (HIDDEN_SIZE * 2);

        let mut out = Vec::with_capacity(input_ids.len() * HIDDEN_SIZE);
        for &id in input_ids {
            let id = usize::try_from(id).ok().filter(|&id| id < vocab_size);
            let Some(id) = id else {
                return Err(BudgetError::SmartParseFailed(format!(
                    "token id out of range for embed_tokens (vocab_size={vocab_size})"
                )));
            };
            let row_start = id * HIDDEN_SIZE * 2;
            let row = &self.weights[row_start..row_start + HIDDEN_SIZE * 2];
            out.extend(
                row.as_chunks::<2>()
                    .0
                    .iter()
                    .map(|b| f16_to_f32(u16::from_le_bytes(*b))),
            );
        }
        Ok(out)
    }
}

struct DecoderNodes {
    inputs_embeds: NodeId,
    attention_mask: NodeId,
    position_ids: NodeId,
    num_logits_to_keep: NodeId,
    logits: NodeId,
    present_ids: Vec<NodeId>,
    past_key_value_ids: Vec<(NodeId, NodeId)>,
}

/// GLM-OCR's decoder: one greedy-decode step in, one step's logits out.
/// Holds `past` (the KV cache) as state across calls -- see this
/// module's own doc comment for why that state must never cross the
/// wasm boundary. **Callers must call `reset()` before every new
/// image's generation**; a `DecoderSession` reused across two scans
/// without a `reset()` in between would silently splice the second
/// scan's tokens onto the first scan's cached keys/values -- wrong
/// output, not a crash, so nothing else will catch this if skipped.
#[derive(Default)]
pub struct DecoderSession {
    model: Option<LoadedModel>,
    nodes: Option<DecoderNodes>,
    staging: Vec<u8>,
    past: Vec<(Tensor<f32>, Tensor<f32>)>,
}

impl DecoderSession {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_data(&mut self, total_len: usize) {
        self.staging = Vec::with_capacity(total_len);
    }

    pub fn append_data_chunk(&mut self, chunk: &[u8]) {
        self.staging.extend_from_slice(chunk);
    }

    pub fn finish(&mut self, graph: Vec<u8>) -> Result<(), BudgetError> {
        let data = std::mem::take(&mut self.staging);
        // `_q4`, not `_fp16` -- see this module's own doc comment for why
        // the decoder specifically loads GLM-OCR's quantized export.
        let model = LoadedModel::load(graph, "decoder_model_merged_q4.onnx_data", data)?;

        let mut present_ids = Vec::with_capacity(2 * NUM_LAYERS);
        let mut past_key_value_ids = Vec::with_capacity(NUM_LAYERS);
        for i in 0..NUM_LAYERS {
            present_ids.push(model.node(&format!("present.{i}.key"))?);
            present_ids.push(model.node(&format!("present.{i}.value"))?);
            past_key_value_ids.push((
                model.node(&format!("past_key_values.{i}.key"))?,
                model.node(&format!("past_key_values.{i}.value"))?,
            ));
        }
        let nodes = DecoderNodes {
            inputs_embeds: model.node("inputs_embeds")?,
            attention_mask: model.node("attention_mask")?,
            position_ids: model.node("position_ids")?,
            num_logits_to_keep: model.node("num_logits_to_keep")?,
            logits: model.node("logits")?,
            present_ids,
            past_key_value_ids,
        };
        self.model = Some(model);
        self.nodes = Some(nodes);
        self.past = zero_past(1);
        Ok(())
    }

    /// Clears the KV cache. Must be called before the first `step` of
    /// every new image -- see this type's own doc comment.
    pub fn reset(&mut self) {
        self.past = zero_past(1);
    }

    /// Runs one greedy-decode step. `inputs_embeds` is a flat
    /// `[seq_len * HIDDEN_SIZE]` buffer (the whole prompt's embeddings
    /// on the first call, one token's embedding on every call after);
    /// `position_ids` is flat, channel-major, length `3 * seq_len`
    /// (matching `smart_parse_orchestrate::rope_index`'s/
    /// `advance_position_ids`'s own layout). Returns flat logits for
    /// this step; internally updates the held KV cache before returning.
    pub fn step(
        &mut self,
        inputs_embeds: &[f32],
        seq_len: usize,
        attention_mask: &[i32],
        position_ids: &[i32],
    ) -> Result<Vec<f32>, BudgetError> {
        let model = self.model.as_ref().ok_or_else(|| {
            BudgetError::SmartParseModelLoadFailed("decoder model not loaded".into())
        })?;
        let nodes = self
            .nodes
            .as_ref()
            .expect("nodes set alongside model in finish()");

        let embeds_tensor = Tensor::from_data(&[1, seq_len, HIDDEN_SIZE], inputs_embeds.to_vec());
        let pos_tensor = Tensor::from_data(&[3, 1, seq_len], position_ids.to_vec());
        let attn_tensor = Tensor::from_data(&[1, attention_mask.len()], attention_mask.to_vec());
        let ntk = Tensor::from_data(&[] as &[usize], vec![1i32]);

        let mut inputs: Vec<(NodeId, rten_embed::ValueOrView)> = vec![
            (nodes.inputs_embeds, embeds_tensor.into()),
            (nodes.attention_mask, attn_tensor.into()),
            (nodes.position_ids, pos_tensor.into()),
            (nodes.num_logits_to_keep, ntk.into()),
        ];
        for (i, (k, v)) in self.past.iter().enumerate() {
            inputs.push((nodes.past_key_value_ids[i].0, k.clone().into()));
            inputs.push((nodes.past_key_value_ids[i].1, v.clone().into()));
        }

        let mut output_ids = vec![nodes.logits];
        output_ids.extend(nodes.present_ids.iter().copied());
        let outputs = model
            .model
            .run(inputs, &output_ids, None)
            .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;

        let logits: Tensor<f32> = outputs[0]
            .clone()
            .try_into()
            .map_err(|_| BudgetError::SmartParseFailed("unexpected decoder output shape".into()))?;
        let logits_data = logits.data().map(|d| d.to_vec()).ok_or_else(|| {
            BudgetError::SmartParseFailed("decoder logits are not contiguous".into())
        })?;

        for i in 0..NUM_LAYERS {
            let k: Tensor<f32> = outputs[1 + 2 * i].clone().try_into().map_err(|_| {
                BudgetError::SmartParseFailed("unexpected present.key shape".into())
            })?;
            let v: Tensor<f32> = outputs[2 + 2 * i].clone().try_into().map_err(|_| {
                BudgetError::SmartParseFailed("unexpected present.value shape".into())
            })?;
            self.past[i] = (k, v);
        }

        Ok(logits_data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f16_to_f32_matches_known_bit_patterns() {
        // IEEE 754 half-precision bit patterns for a handful of exactly
        // representable values, plus zero/negative-zero/subnormal edge
        // cases -- these are the cases most likely to be wrong in a
        // hand-rolled bit-manipulation routine, since they're the ones
        // that take a different branch than the common normalized case.
        assert_eq!(f16_to_f32(0x0000), 0.0);
        assert_eq!(f16_to_f32(0x8000), -0.0);
        assert_eq!(f16_to_f32(0x3C00), 1.0);
        assert_eq!(f16_to_f32(0xBC00), -1.0);
        assert_eq!(f16_to_f32(0x4000), 2.0);
        assert_eq!(f16_to_f32(0x3800), 0.5);
        assert_eq!(f16_to_f32(0x7C00), f32::INFINITY);
        assert_eq!(f16_to_f32(0xFC00), f32::NEG_INFINITY);
        assert!(f16_to_f32(0x7E00).is_nan());
        // Smallest subnormal (2^-24), the case that exercises the
        // leading-zero-count renormalization branch.
        assert_eq!(f16_to_f32(0x0001), 2f32.powi(-24));
    }

    /// Builds a fake `embed_tokens_fp16.onnx_data`-shaped buffer for
    /// `vocab_size` rows, where every value in row `id` is the fp16
    /// encoding of `id as f32` -- enough to tell rows apart without
    /// needing a real downloaded weight file.
    fn fake_weights(vocab_size: usize) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(vocab_size * HIDDEN_SIZE * 2);
        for id in 0..vocab_size {
            let bits = half_bits_for_small_integer(id as u16);
            for _ in 0..HIDDEN_SIZE {
                bytes.extend_from_slice(&bits.to_le_bytes());
            }
        }
        bytes
    }

    /// fp16 encodes small non-negative integers (0..=2048) as a
    /// normalized value with no rounding, so this is exact for every
    /// `id` this test module uses -- avoids needing `f16_to_f32`'s
    /// inverse just to build fixtures for `f16_to_f32` itself.
    fn half_bits_for_small_integer(n: u16) -> u16 {
        if n == 0 {
            return 0;
        }
        let shift = 15 - n.leading_zeros(); // position of the MSB, 0-based
        let mantissa = ((n as u32) << (10 - shift)) & 0x03FF;
        let exponent = (15 + shift as i32) as u16;
        (exponent << 10) | mantissa as u16
    }

    #[test]
    fn embed_looks_up_the_row_for_each_token_id() {
        let mut embedder = TokenEmbedder::new();
        let weights = fake_weights(4);
        embedder.begin_data(weights.len());
        embedder.append_data_chunk(&weights);
        embedder.finish().unwrap();

        let out = embedder.embed(&[2, 0, 3]).unwrap();
        assert_eq!(out.len(), 3 * HIDDEN_SIZE);
        assert!(out[0..HIDDEN_SIZE].iter().all(|&v| v == 2.0));
        assert!(out[HIDDEN_SIZE..2 * HIDDEN_SIZE].iter().all(|&v| v == 0.0));
        assert!(out[2 * HIDDEN_SIZE..3 * HIDDEN_SIZE]
            .iter()
            .all(|&v| v == 3.0));
    }

    #[test]
    fn embed_rejects_a_token_id_past_vocab_size() {
        let mut embedder = TokenEmbedder::new();
        let weights = fake_weights(2);
        embedder.begin_data(weights.len());
        embedder.append_data_chunk(&weights);
        embedder.finish().unwrap();

        assert!(embedder.embed(&[5]).is_err());
    }

    #[test]
    fn embed_before_finish_is_an_error_not_a_panic() {
        let embedder = TokenEmbedder::new();
        assert!(embedder.embed(&[0]).is_err());
    }

    #[test]
    fn finish_rejects_a_weight_buffer_with_a_partial_row() {
        let mut embedder = TokenEmbedder::new();
        let mut weights = fake_weights(1);
        weights.pop(); // one byte short of a whole row
        embedder.begin_data(weights.len());
        embedder.append_data_chunk(&weights);
        assert!(embedder.finish().is_err());
    }
}
