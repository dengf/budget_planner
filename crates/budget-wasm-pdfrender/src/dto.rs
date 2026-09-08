//! Result DTO for `pdf_page_count`. `render_pdf_page` deliberately has no
//! DTO of its own -- see `pdf_render.rs`'s own doc comment for why.

use budget_core::Message;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct PdfPageCountResult {
    pub count: u32,
    pub error: Option<String>,
    pub error_message: Option<Message>,
}
