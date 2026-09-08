//! `pdf_page_count` and `render_pdf_page`.
//!
//! `pdf_page_count` takes the PDF's bytes as a direct `&[u8]` parameter
//! and returns the usual small `to_js`-wrapped DTO -- see
//! `budget-wasm-pdf::pdf_text`'s own doc comment for why raw bytes are a
//! parameter rather than a serde field.
//!
//! `render_pdf_page` deliberately does **not** follow that DTO convention
//! for its return value, even though every other binding in this app's
//! four wasm crates does. A rendered page at 200 DPI is a few million
//! pixels -- `serde_wasm_bindgen`'s JSON-compatible serializer builds a
//! JS value one field at a time across the wasm boundary, and for a
//! `Vec<u8>` field that means one boxed-number push per byte, the same
//! cost `pdf_text.rs` already flags for taking bytes as a *parameter*,
//! just in the return direction instead. wasm-bindgen has a separate,
//! native `Vec<u8>` <-> `Uint8Array` conversion (a single linear-memory
//! copy) that only applies to a plain `Vec<u8>` return type, not a
//! `Vec<u8>` nested inside a serialized struct -- so this function
//! returns one directly, with `width`/`height` packed as an 8-byte
//! little-endian header (u32, u32) in front of the pixel bytes, and
//! `www/src/ocrWorker.js` unpacks that header on the other side.
//!
//! That leaves no room in the return value for the usual `Message`-shaped
//! error. In practice this loses nothing: `receiptCapture.js` always
//! calls `pdf_page_count` first and only ever passes it a page index in
//! `0..count`, so by the time `render_pdf_page` runs, the same bytes have
//! already parsed once (parsing is a pure function of the bytes, so a
//! second parse of identical bytes cannot newly fail) and the index is
//! known in range. The one remaining failure this function can hit --
//! `budget_calc::render_pdf_page` reports a page with zero visible area --
//! isn't really an error so much as "nothing to OCR here"; this binding
//! reports it the same way as any other empty page, an empty `Vec<u8>`,
//! and `receiptCapture.js` skips it rather than failing the whole
//! multi-page scan over one degenerate page.

use wasm_bindgen::prelude::*;

use crate::convert::to_js;
use crate::dto::PdfPageCountResult;
use budget_core::Message;

#[wasm_bindgen]
pub fn pdf_page_count(bytes: &[u8]) -> JsValue {
    to_js(&match budget_calc::pdf_page_count(bytes) {
        Ok(count) => PdfPageCountResult {
            count,
            error: None,
            error_message: None,
        },
        Err(e) => {
            let message = Message::from(&e);
            PdfPageCountResult {
                count: 0,
                error: Some(message.text.clone()),
                error_message: Some(message),
            }
        }
    })
}

#[wasm_bindgen]
pub fn render_pdf_page(bytes: &[u8], page_index: u32) -> Vec<u8> {
    let Ok(page) = budget_calc::render_pdf_page(bytes, page_index) else {
        return Vec::new();
    };
    let mut packed = Vec::with_capacity(8 + page.rgb.len());
    packed.extend_from_slice(&page.width.to_le_bytes());
    packed.extend_from_slice(&page.height.to_le_bytes());
    packed.extend_from_slice(&page.rgb);
    packed
}
