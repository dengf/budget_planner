// Turns a picked receipt file into plain text, then hands that text to
// `budget-wasm` for every actual decision (amount/date/description
// heuristics, OCR itself, PDF text extraction). This module's own job is
// exactly the browser I/O nothing else can do: decode an image via
// canvas (native, no library -- see CLAUDE.md's rule on where a thing
// goes), read a PDF's bytes, and fetch this app's own vendored OCR model
// files. Never a third-party library, never a CDN, never uploads
// anything -- see the receipt-capture plan addendum for why OCR runs as
// a Rust/wasm engine (`ocrs`) rather than a JS one.

const OCR_MODEL_PATHS = {
  detection: 'ocr/text-detection.rten',
  recognition: 'ocr/text-recognition.rten',
};

let modelBytesPromise = null;

async function fetchBytes(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`could not fetch ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Fetched once per page load and kept in memory -- a second scan in the
// same session shouldn't re-download the ~12MB of model data again.
function loadOcrModels() {
  if (!modelBytesPromise) {
    modelBytesPromise = Promise.all([
      fetchBytes(OCR_MODEL_PATHS.detection),
      fetchBytes(OCR_MODEL_PATHS.recognition),
    ]);
  }
  return modelBytesPromise;
}

function isPdf(file) {
  return file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
}

// Browser-native decode: draws the file into an offscreen canvas and
// reads back raw pixels. Not a library -- the same category of host call
// as the `FileReader` the CSV importer already uses, just for pixels
// instead of text. The alpha channel is stripped since the OCR models
// take plain RGB.
async function imageToRgb(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return { rgb, width: canvas.width, height: canvas.height };
}

/**
 * Extracts plain text from a picked receipt file: `pdf-extract` (Rust)
 * for a PDF's text layer, `ocrs` (Rust) for a photographed receipt.
 * Neither path uploads the file anywhere -- both run entirely against
 * bytes already local to this tab.
 *
 * A PDF with no text layer (a scanned image saved as a PDF) is a known
 * v1 gap -- see the plan addendum for why rasterizing it has no clean
 * Rust answer -- and is reported as `pdfNotSupported` rather than
 * silently returning nothing.
 */
export async function extractReceiptText(wasmModule, file) {
  if (isPdf(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await wasmModule.extract_pdf_text(bytes);
    if (result?.error) return { text: '', calcError: result };
    if (!result.text.trim()) {
      return { text: '', calcError: { error: 'pdfNotSupported', error_message: { code: 'transactions.receiptPdfNotSupported', params: {}, text: '' } } };
    }
    return { text: result.text, calcError: null };
  }

  const [[detectionModel, recognitionModel], { rgb, width, height }] = await Promise.all([
    loadOcrModels(),
    imageToRgb(file),
  ]);
  const result = await wasmModule.run_ocr(detectionModel, recognitionModel, rgb, width, height);
  if (result?.error) return { text: '', calcError: result };
  return { text: result.text, calcError: null };
}
