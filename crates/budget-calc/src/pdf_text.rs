//! Text extraction from a PDF already in memory. The bytes come from
//! `www`'s `file.arrayBuffer()` -- the same host-layer read `csv_import`
//! already relies on for a CSV's text -- so this module, like that one,
//! takes bytes and never touches a filesystem or the network.
//!
//! A PDF that is itself just a scanned image has no text layer to find
//! here; that is a real, deliberate v1 gap (see the receipt-capture plan
//! addendum) rather than a bug, and `extract_pdf_text` reports it as an
//! empty string rather than an error so the caller can show its own
//! "try a photo instead" message.

use budget_core::BudgetError;

/// Extracts whatever text a PDF's content streams contain. Returns
/// `Ok("")` for a PDF with no extractable text (most often a scanned
/// image with no text layer) rather than treating that as failure --
/// only a genuinely corrupt/unreadable file is an `Err`.
pub fn extract_pdf_text(bytes: &[u8]) -> Result<String, BudgetError> {
    if bytes.is_empty() {
        return Err(BudgetError::EmptyPdf);
    }
    pdf_extract::extract_text_from_mem(bytes).map_err(|e| BudgetError::UnreadablePdf(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_buffer_is_rejected_before_parsing() {
        assert_eq!(extract_pdf_text(&[]), Err(BudgetError::EmptyPdf));
    }

    #[test]
    fn garbage_bytes_are_reported_as_unreadable_not_a_panic() {
        let err = extract_pdf_text(b"not a pdf at all").unwrap_err();
        assert!(matches!(err, BudgetError::UnreadablePdf(_)));
    }
}
