//! `preset_categories`.

use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::PresetCategoryDto;

/// The starter categories to offer a first-time budget, as
/// `{key, name, group_key, group}` records.
#[wasm_bindgen]
pub fn preset_categories() -> JsValue {
    let presets: Vec<PresetCategoryDto> = budget_calc::starter_categories()
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
        .collect();
    to_js(&presets)
}
