//! The one JS/Rust boundary conversion this crate's bindings need. See
//! `budget-wasm::convert` for the full set and the reasoning behind
//! `to_js` specifically -- duplicated here rather than shared, same
//! reason as `budget-wasm-ocr::convert`: a wasm-bindgen crate compiles
//! to its own standalone `cdylib` and can't depend on a sibling
//! wasm-bindgen crate as a library.

use wasm_bindgen::JsValue;

/// Serializes a result for JavaScript, JSON-compatible so a Rust map
/// becomes a plain JS object rather than a `Map`.
pub fn to_js<T: serde::Serialize + ?Sized>(value: &T) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or(JsValue::NULL)
}
