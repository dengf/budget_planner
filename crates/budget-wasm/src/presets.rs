//! `preset_categories`.

use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::PresetCategoryDto;

fn to_dtos(presets: Vec<budget_calc::PresetCategory>) -> Vec<PresetCategoryDto> {
    presets
        .iter()
        .map(|p| PresetCategoryDto {
            is_income: p.is_income,
            key: p.key.to_string(),
            name: p.name.to_string(),
            group_key: p.group_key.to_string(),
            group: p.group.to_string(),
            description_key: p.description_key.to_string(),
            description: p.description.to_string(),
        })
        .collect()
}

/// The starter categories to offer a first-time budget, as
/// `{key, name, group_key, group}` records.
#[wasm_bindgen]
pub fn preset_categories() -> JsValue {
    to_js(&to_dtos(budget_calc::starter_categories()))
}

/// The compact five-category set a genuinely fresh (or just-cleared)
/// budget is auto-seeded with -- see `budget_calc::presets`'s own doc
/// comment for why this is a subset rather than a separately maintained
/// list. `preset_categories` above remains what the category picker
/// offers, so every other starter category is still one tap away.
#[wasm_bindgen]
pub fn compact_preset_categories() -> JsValue {
    to_js(&to_dtos(budget_calc::compact_starter_categories()))
}
