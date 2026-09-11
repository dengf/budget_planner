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
//! ~1.16GB on-disk -> ~2.16GB resident fp16). Vision and the token
//! embedder stay on their fp16 exports -- GLM-OCR publishes no quantized
//! export of either, and neither one was the model actually trapping.
//! See this crate's `Cargo.toml` for why this requires an unreleased
//! `rten` commit rather than 0.26.0.
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

struct EmbedNodes {
    input_ids: NodeId,
    output: NodeId,
}

/// GLM-OCR's token embedder: token ids in, one flat embedding buffer
/// out. Called once for the whole initial prompt and once per generated
/// token thereafter (up to `smart_parse_orchestrate::MAX_NEW_TOKENS`
/// times), so caching `nodes` in `finish()` rather than re-resolving
/// them per call matters here -- re-resolving by name on every one of
/// ~800 calls would be hundreds of redundant lookups per scan.
#[derive(Default)]
pub struct TokenEmbedder {
    model: Option<LoadedModel>,
    nodes: Option<EmbedNodes>,
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

    pub fn finish(&mut self, graph: Vec<u8>) -> Result<(), BudgetError> {
        let data = std::mem::take(&mut self.staging);
        let model = LoadedModel::load(graph, "embed_tokens_fp16.onnx_data", data)?;
        let nodes = EmbedNodes {
            input_ids: model.node("input_ids")?,
            output: model.model.output_ids()[0],
        };
        self.model = Some(model);
        self.nodes = Some(nodes);
        Ok(())
    }

    /// Embeds `input_ids` (the whole prompt, or a single next-token id),
    /// returning a flat `[input_ids.len() * HIDDEN_SIZE]` buffer.
    pub fn embed(&self, input_ids: &[i32]) -> Result<Vec<f32>, BudgetError> {
        let model = self.model.as_ref().ok_or_else(|| {
            BudgetError::SmartParseModelLoadFailed("embed model not loaded".into())
        })?;
        let nodes = self
            .nodes
            .as_ref()
            .expect("nodes set alongside model in finish()");

        let seq_len = input_ids.len();
        let ids_tensor = Tensor::from_data(&[1, seq_len], input_ids.to_vec());
        let [embeds_val] = model
            .model
            .run_n(
                vec![(nodes.input_ids, ids_tensor.into())],
                [nodes.output],
                None,
            )
            .map_err(|e| BudgetError::SmartParseFailed(e.to_string()))?;
        let embeds: Tensor<f32> = embeds_val.try_into().map_err(|_| {
            BudgetError::SmartParseFailed("unexpected embedding output shape".into())
        })?;
        embeds.data().map(|d| d.to_vec()).ok_or_else(|| {
            BudgetError::SmartParseFailed("embedding output is not contiguous".into())
        })
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
