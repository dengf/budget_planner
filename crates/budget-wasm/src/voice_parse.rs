//! `parse_voice_command` -- turns a raw transcript into a transaction
//! draft. The transcript itself comes from the sibling `budget-wasm-voice`
//! crate's ASR model; this binding is plain text/`Decimal`-free matching
//! with no heavy dependency, so it lives here in the always-loaded core
//! like `receipt.rs`'s text-parsing bindings, not in the lazy crate.

use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::{CategoryDto, ParseVoiceCommandParams, ParseVoiceCommandResult};
use crate::message::Message;

fn candidate_from_dto(dto: &CategoryDto) -> budget_calc::VoiceCategoryCandidate {
    budget_calc::VoiceCategoryCandidate {
        id: dto.id.clone(),
        name: dto.name.clone(),
        is_income: dto.is_income,
        preset_key: dto.preset_key.clone(),
    }
}

#[wasm_bindgen]
pub fn parse_voice_command(params: JsValue) -> JsValue {
    to_js(&parse_voice_command_impl(params))
}

fn parse_voice_command_impl(params: JsValue) -> ParseVoiceCommandResult {
    let params: ParseVoiceCommandParams = if let Ok(p) = serde_wasm_bindgen::from_value(params) {
        p
    } else {
        let message = Message::bad_request();
        return ParseVoiceCommandResult {
            error: Some(message.text),
            ..Default::default()
        };
    };

    let categories: Vec<_> = params.categories.iter().map(candidate_from_dto).collect();
    let draft = budget_calc::parse_voice_command(&params.transcript, &categories);

    ParseVoiceCommandResult {
        category_id: draft.category_id,
        is_income: draft.is_income,
        amount: draft.amount,
        error: None,
    }
}
