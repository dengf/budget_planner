//! The two JS/Rust boundary conversions this crate's bindings need. See
//! `budget-wasm::convert` for the full set and the reasoning behind
//! `to_js` specifically -- duplicated here rather than shared, since a
//! wasm-bindgen crate compiles to its own standalone `cdylib` and can't
//! depend on a sibling wasm-bindgen crate as a library. These two are
//! small, generic and stable (no per-error-code mapping that could drift
//! the way `Message` could -- see why that one *did* move to
//! `budget-core` instead, in this crate's `lib.rs`).

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use wasm_bindgen::JsValue;

/// Serializes a result for JavaScript, JSON-compatible so a Rust map
/// becomes a plain JS object rather than a `Map`.
pub fn to_js<T: serde::Serialize + ?Sized>(value: &T) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or(JsValue::NULL)
}

pub fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_f64().unwrap_or(0.0)
}
