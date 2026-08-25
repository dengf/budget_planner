use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("record not found: {0}")]
    NotFound(String),

    #[error("serialization error: {0}")]
    Serialization(String),

    #[error("backend error: {0}")]
    Backend(String),
}
