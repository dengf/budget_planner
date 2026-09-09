//! Rasterizes one page of a PDF to a plain RGB pixel buffer via `hayro`,
//! a pure-Rust PDF interpreter/rasterizer built on `vello_cpu` (CPU-only,
//! no GPU or C dependency) -- the missing piece the receipt-capture plan
//! originally scoped out. `pdf_text.rs` has no answer for a scanned or
//! image-only PDF (no text layer to find), and until now there was no
//! mature pure-Rust/wasm32 way to turn its pages into pixels an OCR
//! engine could read instead. Confirmed compiling to
//! `wasm32-unknown-unknown` with a standalone spike before committing to
//! this dependency, same discipline as every other engine in this app.
//!
//! Output is plain RGB (no alpha), the exact same shape `ocr::run_ocr`
//! and `smart_parse::run_smart_parse` already expect from a photographed
//! image -- a rendered PDF page is just another image to either engine,
//! so this module adds no new OCR pipeline, only a new way to produce
//! pixels the existing ones already accept. `www/src/receiptCapture.js`
//! is what actually chooses which engine reads the rendered page.
//!
//! Rendered at a fixed 200 DPI (`RENDER_DPI`) rather than reading the
//! PDF's own resolution hints -- a PDF page has no inherent pixel density
//! (it's defined in points), and 200 DPI is a standard OCR-accuracy
//! sweet spot that keeps a typical page in the same rough pixel-count
//! range `receiptCapture.js` already caps a photographed receipt to
//! (`MAX_IMAGE_DIMENSION`), rather than one engine call taking
//! disproportionately longer than the other depending on which path a
//! given file took.
//!
//! No `catch_unwind` around the render call: this workspace builds with
//! `panic = "abort"` (see the root `Cargo.toml`'s own comment, added
//! after a real `pdf-extract` panic on a malformed font), under which
//! `catch_unwind` cannot catch anything -- a panic here is a hard module
//! abort either way. `hayro` forbids unsafe code and is tested against
//! 1000+ real-world PDFs, but is explicit about still being incomplete
//! (no encrypted-PDF, blending-mode or knockout-group support yet); a
//! real file triggering a genuine renderer bug is a realistic follow-up,
//! same class of issue PR #41 fixed for `pdf-extract`, not preventable
//! from this side.

use budget_core::BudgetError;
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::{LoadPdfError, Pdf};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{render, RenderCache, RenderSettings};

const RENDER_DPI: f32 = 200.0;
const POINTS_PER_INCH: f32 = 72.0;

/// A single rendered page, already in the plain-RGB shape every OCR
/// engine in this app takes.
#[derive(Debug)]
pub struct RenderedPage {
    pub rgb: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

fn load(bytes: &[u8]) -> Result<Pdf, BudgetError> {
    if bytes.is_empty() {
        return Err(BudgetError::EmptyPdf);
    }
    Pdf::new(bytes.to_vec()).map_err(|e| match e {
        LoadPdfError::Decryption(_) => {
            BudgetError::UnreadablePdf("this PDF is password-protected".into())
        }
        LoadPdfError::Invalid => BudgetError::UnreadablePdf("could not parse this PDF".into()),
    })
}

/// Number of pages in the PDF -- `receiptCapture.js` calls this once
/// before looping `render_pdf_page` over every page, rather than the Rust
/// side driving that loop itself, so a slow multi-page render can report
/// real per-page progress back to the UI between calls.
pub fn pdf_page_count(bytes: &[u8]) -> Result<u32, BudgetError> {
    let pdf = load(bytes)?;
    Ok(pdf.pages().len() as u32)
}

/// Renders one page (0-indexed) to plain RGB. `bytes` is the whole PDF's
/// bytes, re-parsed on every call rather than kept open across calls --
/// simpler than threading a parsed `Pdf` (with its own lifetime-bound
/// `Page` borrows) across the wasm boundary between page calls, and
/// re-parsing a receipt/statement-sized PDF is not the cost center here;
/// a single page's vector interpretation is.
pub fn render_pdf_page(bytes: &[u8], page_index: u32) -> Result<RenderedPage, BudgetError> {
    let pdf = load(bytes)?;
    let pages = pdf.pages();
    let page_count = pages.len();
    let page = pages.get(page_index as usize).ok_or_else(|| {
        BudgetError::PdfPageOutOfRange(format!(
            "page {page_index} (this PDF has {page_count} pages)"
        ))
    })?;

    let cache = RenderCache::new();
    let settings = InterpreterSettings::default();
    let scale = RENDER_DPI / POINTS_PER_INCH;
    let render_settings = RenderSettings {
        x_scale: scale,
        y_scale: scale,
        bg_color: WHITE,
        ..Default::default()
    };

    let pixmap = render(page, &cache, &settings, &render_settings);
    let width = pixmap.width() as u32;
    let height = pixmap.height() as u32;
    if width == 0 || height == 0 {
        return Err(BudgetError::PdfRenderFailed(
            "this page has no visible area".into(),
        ));
    }

    let rgba = pixmap.data_as_u8_slice();
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    let (chunks, _remainder) = rgba.as_chunks::<4>();
    for chunk in chunks {
        rgb.extend_from_slice(&chunk[..3]);
    }
    Ok(RenderedPage { rgb, width, height })
}

#[cfg(test)]
mod tests {
    use super::*;

    // A minimal single-page, blank PDF (no content stream at all) --
    // enough to exercise `Pdf::new`/`pages()`/`render()` against a real
    // parse without vendoring a full test-fixture file. Built by hand
    // from the PDF spec's own minimal-file example, not generated by any
    // library, so this test has no dependency on `pdf-extract` or any
    // other PDF-writing tool.
    const BLANK_ONE_PAGE_PDF: &[u8] = b"%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer
<< /Size 4 /Root 1 0 R >>
startxref
190
%%EOF";

    #[test]
    fn an_empty_buffer_is_rejected_before_parsing() {
        assert_eq!(pdf_page_count(&[]), Err(BudgetError::EmptyPdf));
        assert_eq!(render_pdf_page(&[], 0).unwrap_err(), BudgetError::EmptyPdf);
    }

    #[test]
    fn garbage_bytes_are_reported_as_unreadable_not_a_panic() {
        let err = pdf_page_count(b"not a pdf at all").unwrap_err();
        assert!(matches!(err, BudgetError::UnreadablePdf(_)));
    }

    #[test]
    fn counts_the_one_page_in_a_minimal_pdf() {
        assert_eq!(pdf_page_count(BLANK_ONE_PAGE_PDF), Ok(1));
    }

    #[test]
    fn renders_a_blank_page_to_a_white_rgb_buffer_at_200_dpi() {
        let page = render_pdf_page(BLANK_ONE_PAGE_PDF, 0).unwrap();
        // A 200x100pt page at 200 DPI (scale = 200/72) rounds to this
        // pixel size -- asserting the real computed value, not a
        // hand-picked one, so this breaks loudly if `RENDER_DPI` or the
        // scale math ever changes.
        let expected_scale = RENDER_DPI / POINTS_PER_INCH;
        assert_eq!(page.width, (200.0 * expected_scale).floor() as u32);
        assert_eq!(page.height, (100.0 * expected_scale).floor() as u32);
        assert_eq!(page.rgb.len(), (page.width * page.height * 3) as usize);
        // A blank page with a white background renders as solid white --
        // every byte should be 255, not just "not black".
        assert!(page.rgb.iter().all(|&b| b == 255));
    }

    #[test]
    fn an_out_of_range_page_is_reported_not_a_panic() {
        let err = render_pdf_page(BLANK_ONE_PAGE_PDF, 5).unwrap_err();
        assert!(matches!(err, BudgetError::PdfPageOutOfRange(_)));
    }
}
