// Turns a picked receipt file into plain text, then hands that text to
// `budget-wasm-ocr` for every actual decision (amount/date/description
// heuristics, OCR itself, PDF text extraction). This module's own job is
// exactly the browser I/O nothing else can do: decode an image via
// canvas (native, no library -- see CLAUDE.md's rule on where a thing
// goes), read a PDF's bytes, and fetch this app's own vendored OCR model
// files. Never a third-party library, never a CDN, never uploads
// anything -- see the receipt-capture plan addendum for why OCR runs as
// a Rust/wasm engine (`ocrs`) rather than a JS one.
//
// `budget-wasm-ocr` is a *separate* wasm module from the one `index.js`
// loads at startup, not just a separate Rust crate -- `ocrs`/`rten` pull
// in a full ML tensor runtime that dwarfed the budgeting math it used to
// ship alongside (3.7MB vs ~800KB once split; see that crate's own doc
// comment). `loadOcrModule` below `import()`s it lazily, so the ~3MB
// engine only downloads the first time someone actually opens "Take a
// photo" or "Upload PDF", never on an ordinary budgeting visit.

const OCR_MODEL_PATHS = {
  detection: 'ocr/text-detection.rten',
  recognition: 'ocr/text-recognition.rten',
};

let ocrModulePromise = null;

// Mirrors index.js's initWasm: fetch the glue module, run its default
// init (which fetches and instantiates the .wasm binary), cache the
// result so a second scan in the same session doesn't redo either.
function loadOcrModule() {
  if (!ocrModulePromise) {
    ocrModulePromise = import('../pkg-ocr').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return ocrModulePromise;
}

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
export async function extractReceiptText(file) {
  const ocrModule = await loadOcrModule();

  if (isPdf(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await ocrModule.extract_pdf_text(bytes);
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
  const result = await ocrModule.run_ocr(detectionModel, recognitionModel, rgb, width, height);
  if (result?.error) return { text: '', calcError: result };
  return { text: result.text, calcError: null };
}

/** The amount/date/description heuristics over OCR/PDF-extracted text --
 * see `budget_calc::receipt` -- bound in the same lazily-loaded module. */
export async function parseReceiptText(text) {
  const ocrModule = await loadOcrModule();
  return ocrModule.parse_receipt_text(text);
}
