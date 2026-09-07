//! Classifies a `StatementRow` whose direction `resolve_statement_amount`
//! had to guess (`direction_is_guessed: true` -- no explicit sign, no
//! `CR`/`DB` marker, no `INCOME_KEYWORDS` hit) as income or expense,
//! using a small sentence-embedding model rather than a generative chat
//! LLM.
//!
//! A generative model (autoregressive decoding, a KV-cache/sampling
//! loop) is the wrong tool for this: it's binary classification of a
//! short string, not text generation. A spike comparing the two
//! (native, throwaway, never committed) found a ~1.2GB instruction-tuned
//! chat model plateaued at 83-92% accuracy across several prompts and
//! took ~1-1.5s per call, while a 23MB BERT-family encoder
//! (`Xenova/all-MiniLM-L6-v2`, embedding a description and comparing it
//! to `receipt::INCOME_EXAMPLE_PHRASES`/`EXPENSE_EXAMPLE_PHRASES` by
//! cosine similarity, nearest-neighbor style) scored 100% on the same
//! test set at ~3ms/call: no free-form generation to hallucinate a
//! malformed answer, one forward pass instead of a decode loop, two
//! orders of magnitude smaller.
//!
//! Model and tokenizer bytes arrive as plain buffers, same reason as
//! `ocr.rs`: no filesystem inside wasm, so both are fetched by the host
//! layer (`www`'s `fetch`) and passed in already read.

use budget_core::BudgetError;
use rten_embed::Model;
use rten_tensor::prelude::*;
use rten_tensor::Tensor;
use rten_text::Tokenizer;

use crate::receipt::{classify_by_similarity, EXPENSE_EXAMPLE_PHRASES, INCOME_EXAMPLE_PHRASES};

struct Embedder {
    model: Model,
    tokenizer: Tokenizer,
    input_ids_id: rten_embed::NodeId,
    attention_mask_id: rten_embed::NodeId,
    token_type_ids_id: rten_embed::NodeId,
    output_id: rten_embed::NodeId,
}

impl Embedder {
    fn load(model_bytes: Vec<u8>, tokenizer_json: &[u8]) -> Result<Self, BudgetError> {
        let model = Model::load(model_bytes)
            .map_err(|e| BudgetError::EmbedModelLoadFailed(e.to_string()))?;
        let tokenizer_json = std::str::from_utf8(tokenizer_json)
            .map_err(|e| BudgetError::EmbedTokenizerLoadFailed(e.to_string()))?;
        let tokenizer = Tokenizer::from_json(tokenizer_json)
            .map_err(|e| BudgetError::EmbedTokenizerLoadFailed(e.to_string()))?;

        let node = |name: &str| -> Result<rten_embed::NodeId, BudgetError> {
            model
                .node_id(name)
                .map_err(|e| BudgetError::EmbedModelLoadFailed(e.to_string()))
        };
        Ok(Self {
            input_ids_id: node("input_ids")?,
            attention_mask_id: node("attention_mask")?,
            token_type_ids_id: node("token_type_ids")?,
            output_id: node("last_hidden_state")?,
            model,
            tokenizer,
        })
    }

    /// A mean-pooled, L2-normalized sentence embedding -- standard
    /// `sentence-transformers` post-processing for this model family.
    /// Every position is a real token here (one sequence at a time, no
    /// padding), so mean-pooling needs no attention-mask weighting.
    fn embed(&self, text: &str) -> Result<Vec<f32>, BudgetError> {
        let encoded = self
            .tokenizer
            .encode(text, None)
            .map_err(|e| BudgetError::EmbedClassifyFailed(e.to_string()))?;
        let ids: Vec<i32> = encoded.token_ids().iter().map(|&id| id as i32).collect();
        let seq_len = ids.len();

        let input_ids = Tensor::from_data(&[1, seq_len], ids);
        let attention_mask = Tensor::from_data(&[1, seq_len], vec![1i32; seq_len]);
        let token_type_ids = Tensor::from_data(&[1, seq_len], vec![0i32; seq_len]);

        let [output] = self
            .model
            .run_n(
                vec![
                    (self.input_ids_id, input_ids.into()),
                    (self.attention_mask_id, attention_mask.into()),
                    (self.token_type_ids_id, token_type_ids.into()),
                ],
                [self.output_id],
                None,
            )
            .map_err(|e| BudgetError::EmbedClassifyFailed(e.to_string()))?;
        let hidden: Tensor<f32> = output
            .try_into()
            .map_err(|_| BudgetError::EmbedClassifyFailed("unexpected output shape".into()))?;

        let hidden_dim = hidden.shape()[2];
        let mut pooled = vec![0f32; hidden_dim];
        for t in 0..seq_len {
            for d in 0..hidden_dim {
                pooled[d] += hidden[[0, t, d]];
            }
        }
        for v in &mut pooled {
            *v /= seq_len as f32;
        }
        let norm: f32 = pooled.iter().map(|v| v * v).sum::<f32>().sqrt();
        for v in &mut pooled {
            *v /= norm;
        }
        Ok(pooled)
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Classifies each description as income (`true`) or expense (`false`),
/// in order. Loads the model and embeds the example phrases once for
/// the whole batch, not per row -- the caller (`budget-wasm-llm`) should
/// pass every ambiguous row from one statement in a single call rather
/// than calling this once per row.
pub fn classify_statement_descriptions(
    model_bytes: Vec<u8>,
    tokenizer_json: &[u8],
    descriptions: &[String],
) -> Result<Vec<bool>, BudgetError> {
    if descriptions.is_empty() {
        return Ok(Vec::new());
    }

    let embedder = Embedder::load(model_bytes, tokenizer_json)?;
    let income_vecs: Vec<Vec<f32>> = INCOME_EXAMPLE_PHRASES
        .iter()
        .map(|s| embedder.embed(s))
        .collect::<Result<_, _>>()?;
    let expense_vecs: Vec<Vec<f32>> = EXPENSE_EXAMPLE_PHRASES
        .iter()
        .map(|s| embedder.embed(s))
        .collect::<Result<_, _>>()?;

    descriptions
        .iter()
        .map(|description| {
            let v = embedder.embed(description)?;
            let best_income = income_vecs
                .iter()
                .map(|e| cosine(&v, e))
                .fold(f32::MIN, f32::max);
            let best_expense = expense_vecs
                .iter()
                .map(|e| cosine(&v, e))
                .fold(f32::MIN, f32::max);
            Ok(classify_by_similarity(best_income, best_expense))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn garbage_model_bytes_fail_to_load_rather_than_panicking() {
        let err =
            classify_statement_descriptions(b"not a model".to_vec(), b"{}", &["X".to_string()])
                .unwrap_err();
        assert!(matches!(err, BudgetError::EmbedModelLoadFailed(_)));
    }

    #[test]
    fn an_empty_batch_short_circuits_before_touching_the_model() {
        let result = classify_statement_descriptions(vec![], b"", &[]).unwrap();
        assert!(result.is_empty());
    }
}
