## pdf-extract (budget-planner patched fork)

Vendored from upstream [pdf-extract 0.12.0](https://crates.io/crates/pdf-extract/0.12.0)
(MIT licensed) via `[patch.crates-io]` in this workspace's root `Cargo.toml`,
not published or otherwise distributed independently.

**Patch**: `src/lib.rs`'s `PdfSimpleFont::decode_char` used to `.expect()`
when a font had a `unicode_map` with no entry for a given character *and*
no fallback `encoding` table at all -- a real bank-statement PDF hit this
during budget-planner's receipt-capture testing, and since this workspace's
release profile uses `panic = "abort"` (see root `Cargo.toml`), that panic
aborted the whole wasm module rather than failing gracefully. Changed to
fall back to `PDFDocEncoding`, matching the sibling branch in the same
function that already does this when `unicode_map` is absent entirely.
Search this file for "budget-planner patch" to find the change.

To refresh against a newer upstream release: copy the new version's `src/`
over this directory, re-apply the same one-line change (swap the `.expect()`
back for `.unwrap_or(&PDFDocEncoding)`), and re-run
`crates/budget-wasm-pdf`'s isolated `wasm-pack build` plus `cargo test
--workspace` before landing.

---

## pdf-extract
[![Build Status](https://github.com/jrmuizel/pdf-extract/actions/workflows/rust.yml/badge.svg)](https://github.com/jrmuizel/pdf-extract/actions)
[![crates.io](https://img.shields.io/crates/v/pdf-extract.svg)](https://crates.io/crates/pdf-extract)
[![Documentation](https://docs.rs/pdf-extract/badge.svg)](https://docs.rs/pdf-extract)

A rust library to extract content from PDF files.

```rust
let bytes = std::fs::read("tests/docs/simple.pdf").unwrap();
let out = pdf_extract::extract_text_from_mem(&bytes).unwrap();
assert!(out.contains("This is a small demonstration"));
```

## See also

- https://github.com/elacin/PDFExtract/
- https://github.com/euske/pdfminer / https://github.com/pdfminer/pdfminer.six
- https://gitlab.com/crossref/pdfextract
- https://github.com/VikParuchuri/marker
- https://github.com/kermitt2/pdfalto used by [grobid](https://github.com/kermitt2/grobid/)
- https://github.com/opendatalab/MinerU (uses PyMuPDF and pdfminer.six)

### Not PDF specific
- https://github.com/Layout-Parser/layout-parser
