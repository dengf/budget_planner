//! `preset_categories`.

use wasm_bindgen::prelude::*;

use crate::convert::{parse_region, to_js};
use crate::dto::PresetCategoryDto;

/// The starter categories for a region, as `{key, name, group_key, group}`
/// records. No error path: an unrecognized region falls back to the
/// default rather than failing, since an unknown region string is a
/// frontend bug, not something a user can type.
#[wasm_bindgen]
pub fn preset_categories(region: Option<String>) -> JsValue {
    let presets: Vec<PresetCategoryDto> = budget_calc::for_region(parse_region(region.as_deref()))
        .iter()
        .map(|p| PresetCategoryDto {
            is_income: p.is_income,
            key: p.key.to_string(),
            name: p.name.to_string(),
            group_key: p.group_key.to_string(),
            group: p.group.to_string(),
        })
        .collect();
    to_js(&presets)
}
