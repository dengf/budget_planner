//! Re-exports `budget_core::Message` -- the type itself, its `BudgetError`
//! mapping and its own unit tests now live in `budget-core`, shared with
//! the lazily-loaded `budget-wasm-ocr` crate. See that module's doc
//! comment for why: two wasm-bindgen crates map the same `BudgetError`
//! enum to this same shape, and duplicating that mapping was exactly the
//! kind of drift risk CLAUDE.md warns about.

pub use budget_core::Message;

/// Guards the boundary against leaking a foreign error's `Debug` output to
/// the page. Ported verbatim from mortgage-wasm's `message.rs`; see that
/// module for the full rationale (a `serde_wasm_bindgen::Error`'s `Debug`
/// rendering is a live JS stack trace).
///
/// Scans only this crate's own binding files -- `budget-wasm-ocr` and
/// `budget-wasm-pdf` each run the identical guard over their own single
/// binding, since bindings split across crates need the check applied
/// per crate, not once globally.
#[cfg(test)]
mod no_debug_formatted_errors {
    const BINDINGS: &[(&str, &str)] = &[
        ("category.rs", include_str!("category.rs")),
        ("transaction.rs", include_str!("transaction.rs")),
        ("rules.rs", include_str!("rules.rs")),
        ("csv_import.rs", include_str!("csv_import.rs")),
        ("goals.rs", include_str!("goals.rs")),
        ("debt.rs", include_str!("debt.rs")),
        ("presets.rs", include_str!("presets.rs")),
        ("receipt.rs", include_str!("receipt.rs")),
        ("recurring.rs", include_str!("recurring.rs")),
        // include_str! reads the file regardless of the target the crate is
        // compiled for -- only the `pub mod storage;` declaration in lib.rs
        // is cfg-gated to wasm32, so this line is safe to keep unconditional.
        ("storage.rs", include_str!("storage.rs")),
    ];

    #[test]
    fn every_binding_serializes_through_the_json_compatible_helper() {
        let mut offenders = Vec::new();
        for (name, source) in BINDINGS {
            for (i, line) in source.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                if code.contains("serde_wasm_bindgen::to_value") {
                    offenders.push(format!("{name}:{}", i + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these lines serialize with serde_wasm_bindgen::to_value: {offenders:?}. \
             Use convert::to_js."
        );
    }

    #[test]
    fn no_binding_debug_formats_an_error_into_a_user_facing_field() {
        let mut offenders = Vec::new();
        for (name, source) in BINDINGS {
            for (i, line) in source.lines().enumerate() {
                let code = line.split("//").next().unwrap_or(line);
                if code.contains("{e:?}") || code.contains("{err:?}") {
                    offenders.push(format!("{name}:{}", i + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "these lines Debug-format an error that reaches the DOM: {offenders:?}. \
             Use Message::bad_request() instead."
        );
    }

    #[test]
    fn the_bad_request_message_names_no_internals() {
        let text = super::Message::bad_request().text;
        for leak in ["wasm", "Error(", "JsValue", "f64", ".js:", "0x"] {
            assert!(
                !text.contains(leak),
                "bad_request text leaks {leak:?}: {text}"
            );
        }
    }
}
