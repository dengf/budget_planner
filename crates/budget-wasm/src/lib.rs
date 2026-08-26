//! WebAssembly bindings for the budget-planner library.
//!
//! Same split as mortgage-wasm: the public `#[wasm_bindgen]` surface is
//! grouped by responsibility --
//!
//! - [`category`] -- `build_month`
//! - [`transaction`] -- `spend_by_category`
//! - [`rules`] -- `apply_rules`
//! - [`csv_import`] -- `import_csv`
//! - [`goals`] -- `goal_progress`, `milestone_crossed`, `required_contribution`
//! - [`debt`] -- `build_payoff_plan`
//! - [`presets`] -- `preset_categories`
//! - [`recurring`] -- `recurring_occurrences`
//! - [`storage`] (wasm32 only) -- `init_storage` plus save/list/delete for
//!   each of the six persisted collections, backed by
//!   `budget-ext-redb`'s wasm/IndexedDB-persisted store. Gated to wasm32
//!   for the same reason as mortgage-wasm's: it calls
//!   `RedbBudgetStore::open_wasm()`, which only exists on that target.
//!
//! No business logic lives in this crate -- every function parses a
//! `JsValue`, calls into `budget-calc` or `budget-ext-redb`, and
//! serializes the result back. See CLAUDE.md.

use wasm_bindgen::prelude::*;

pub mod category;
pub mod convert;
pub mod csv_import;
pub mod debt;
pub mod dto;
pub mod goals;
pub mod message;
pub mod presets;
pub mod recurring;
pub mod rules;
#[cfg(target_arch = "wasm32")]
pub mod storage;
pub mod transaction;

pub use category::build_month;
pub use csv_import::import_csv;
pub use debt::build_payoff_plan;
pub use goals::{goal_progress, milestone_crossed, required_contribution};
pub use message::Message;
pub use presets::preset_categories;
pub use recurring::recurring_occurrences;
pub use rules::apply_rules;
#[cfg(target_arch = "wasm32")]
pub use storage::{
    delete_budget_plan_entry, delete_category, delete_debt, delete_goal, delete_recurring_expense,
    delete_rule, delete_transaction, init_storage, list_budget_plan, list_categories, list_debts,
    list_goals, list_recurring_expenses, list_rules, list_transactions, save_budget_plan_entry,
    save_category, save_debt, save_goal, save_recurring_expense, save_rule, save_transaction,
};
pub use transaction::spend_by_category;

/// A new locally-generated record id, for the frontend to assign before
/// calling any `save_*` storage function -- see `convert::new_record_id`.
#[wasm_bindgen]
pub fn new_id() -> String {
    convert::new_record_id()
}

/// Guards against this crate silently falling behind `budget-calc`. See
/// mortgage-wasm's identical guard for the incident that motivated it: a
/// capability shipped in one front end for months because nothing here
/// forced a matching binding to exist.
#[cfg(test)]
mod bridge_coverage {
    const NOT_BRIDGED: &[(&str, &str)] = &[];

    fn public_modules(source: &str) -> Vec<String> {
        source
            .lines()
            .map(str::trim)
            .filter_map(|line| line.strip_prefix("pub mod "))
            .filter_map(|rest| rest.strip_suffix(';'))
            .map(str::to_string)
            .collect()
    }

    fn unbridged(calc_source: &str, wasm_source: &str) -> Vec<String> {
        let bridged = public_modules(wasm_source);
        public_modules(calc_source)
            .into_iter()
            .filter(|m| !bridged.contains(m))
            .filter(|m| !NOT_BRIDGED.iter().any(|(name, _)| *name == m.as_str()))
            .collect()
    }

    #[test]
    fn every_public_budget_calc_module_has_a_wasm_binding() {
        let calc = include_str!("../../budget-calc/src/lib.rs");

        assert!(
            !public_modules(calc).is_empty(),
            "parsed no public modules from budget-calc; the `pub mod` parse likely broke"
        );

        let missing = unbridged(calc, include_str!("lib.rs"));
        assert!(
            missing.is_empty(),
            "budget-calc exposes {missing:?} with no matching binding in budget-wasm, \
             so the web app cannot reach it. Add a `pub mod` here wrapping it, or list it \
             in NOT_BRIDGED with a reason."
        );
    }

    #[test]
    fn the_guard_detects_a_core_module_with_no_binding() {
        let calc = "pub mod payment;\npub mod brand_new_thing;\n";
        let wasm = "pub mod payment;\n";
        assert_eq!(unbridged(calc, wasm), vec!["brand_new_thing".to_string()]);
    }

    #[test]
    fn the_guard_is_quiet_when_everything_is_bridged() {
        let calc = "pub mod payment;\npub mod refinance;\n";
        let wasm = "pub mod payment;\npub mod refinance;\npub mod dto;\n";
        assert!(unbridged(calc, wasm).is_empty());
    }
}

/// Initialize the WASM module (sets up panic hook for better error messages).
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
