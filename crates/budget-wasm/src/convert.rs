//! Conversions across the JS/Rust boundary: JS deals in `f64` and plain
//! strings, Rust deals in `Decimal` and typed enums.

use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use wasm_bindgen::prelude::*;

use budget_calc::Strategy;
use budget_core::Cadence;

/// Serializes a result for JavaScript, JSON-compatible so a Rust map
/// becomes a plain JS object rather than a `Map` -- see mortgage-wasm's
/// `convert::to_js` for the bug this avoids (an interpolator reading
/// `hasOwnProperty` finding nothing on a `Map`).
pub fn to_js<T: serde::Serialize + ?Sized>(value: &T) -> JsValue {
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap_or(JsValue::NULL)
}

/// Converts a JS `f64` amount into `Decimal`, rejecting non-finite input
/// (NaN/Infinity from a failed `parseFloat`) rather than silently
/// treating it as zero -- a zero-cost mistake for most fields, but a
/// dangerous one for a goal target or a debt balance.
pub fn f64_to_decimal(value: f64) -> Option<Decimal> {
    if !value.is_finite() {
        return None;
    }
    Decimal::from_f64(value)
}

pub fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_f64().unwrap_or(0.0)
}

/// For persistence: `Decimal`'s own `Display`, which round-trips exactly
/// (unlike `f64`, which is only used at the JS boundary itself).
pub fn decimal_to_string(value: Decimal) -> String {
    value.to_string()
}

/// The inverse of `decimal_to_string`. `None` on a corrupted record rather
/// than panicking -- a hand-edited IndexedDB entry is a real, if rare,
/// way for this to happen.
pub fn string_to_decimal(value: &str) -> Option<Decimal> {
    value.parse().ok()
}

/// A new id for a locally-created record: current time plus a random
/// suffix, so two records saved in the same millisecond still differ.
/// Same shape as mortgage-wasm's `new_scenario_id`.
pub fn new_record_id() -> String {
    let now = js_sys::Date::now();
    let random = (js_sys::Math::random() * 1e9) as u64;
    format!("{now:.0}-{random:x}")
}

/// Fractional APR as entered (`19.9` for 19.9%) into the fraction
/// `budget-calc` expects (`0.199`).
pub fn percent_to_rate(percent: f64) -> Option<Decimal> {
    Some(f64_to_decimal(percent)? / Decimal::from(100))
}

pub fn rate_to_percent(rate: Decimal) -> f64 {
    decimal_to_f64(rate * Decimal::from(100))
}

pub fn cadence_name(cadence: Cadence) -> &'static str {
    match cadence {
        Cadence::Weekly => "weekly",
        Cadence::Fortnightly => "fortnightly",
        Cadence::Monthly => "monthly",
        Cadence::Quarterly => "quarterly",
        Cadence::Yearly => "yearly",
    }
}

pub fn parse_cadence(cadence: Option<&str>) -> Cadence {
    match cadence.map(str::to_lowercase).as_deref() {
        Some("weekly") => Cadence::Weekly,
        Some("fortnightly") | Some("bi-weekly") | Some("biweekly") => Cadence::Fortnightly,
        Some("quarterly") => Cadence::Quarterly,
        Some("yearly") | Some("annual") | Some("annually") => Cadence::Yearly,
        _ => Cadence::Monthly,
    }
}

pub fn strategy_name(strategy: Strategy) -> &'static str {
    match strategy {
        Strategy::Snowball => "snowball",
        Strategy::Avalanche => "avalanche",
    }
}

pub fn parse_strategy(strategy: Option<&str>) -> Strategy {
    match strategy.map(str::to_lowercase).as_deref() {
        Some("avalanche") => Strategy::Avalanche,
        _ => Strategy::Snowball,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn every_cadence_survives_a_round_trip() {
        for cadence in [
            Cadence::Weekly,
            Cadence::Fortnightly,
            Cadence::Monthly,
            Cadence::Quarterly,
            Cadence::Yearly,
        ] {
            assert_eq!(parse_cadence(Some(cadence_name(cadence))), cadence);
        }
    }

    #[test]
    fn every_strategy_survives_a_round_trip() {
        for strategy in [Strategy::Snowball, Strategy::Avalanche] {
            assert_eq!(parse_strategy(Some(strategy_name(strategy))), strategy);
        }
    }

    #[test]
    fn f64_to_decimal_rejects_nan_and_infinity() {
        assert_eq!(f64_to_decimal(f64::NAN), None);
        assert_eq!(f64_to_decimal(f64::INFINITY), None);
    }

    #[test]
    fn percent_to_rate_converts_a_normal_value() {
        assert_eq!(percent_to_rate(19.9), Some(dec!(0.199)));
    }
}
