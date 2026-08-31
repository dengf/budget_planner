// Turns a picked receipt file into plain text: OCR (`budget-wasm-ocr`)
// for a photographed receipt, `pdf-extract` (`budget-wasm-pdf`) for a
// PDF's text layer. This module's own job is exactly the browser I/O
// nothing else can do: decode an image via canvas (native, no library --
// see CLAUDE.md's rule on where a thing goes), read a PDF's bytes, and
// fetch this app's own vendored OCR model files. Never a third-party
// library, never a CDN, never uploads anything -- see the receipt-capture
// plan addendum for why OCR runs as a Rust/wasm engine (`ocrs-cjk`) rather
// than a JS one.
//
// Turning that text into a draft transaction (amount/date/description
// heuristics) is a separate step this module does NOT do -- see
// `ReceiptCapture.jsx`, which calls the always-loaded core module's
// `parse_receipt_text` directly rather than going through either lazy
// module or `ocrWorker.js` below, since that parsing has no heavy
// dependency and doesn't need either.
//
// `budget-wasm-ocr` and `budget-wasm-pdf` are two *separate* wasm modules
// from the one `index.js` loads at startup, not just separate Rust crates
// -- `ocrs-cjk`/`rten` (OCR) and `pdf-extract` (PDF) each pull in real weight
// (see each crate's own doc comment) that dwarfed the budgeting math they
// used to ship alongside, and that were bundled together with each other
// until a size audit found each one paying for the other's dependency
// chain despite the two paths never running in the same session. Each
// only downloads the first time someone actually takes that specific
// path -- a photo scan never fetches `pkg-pdf`, a PDF upload never
// fetches `pkg-ocr` -- never on an ordinary budgeting visit.
//
// Both also only ever run inside `ocrWorker.js`, not here. A real scan
// was a multi-second synchronous Rust call that froze the whole tab --
// reported live, no scrolling or clicks worked for 20-40+ seconds on
// ordinary hardware. Every function below talks to that worker instead
// of either wasm module directly; see its own doc comment for the rest
// of the story.

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./ocrWorker.js', import.meta.url));
  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data;
    const call = pending.get(id);
    if (!call) return; // already settled, or from a worker instance we've moved past
    pending.delete(id);
    if (ok) call.resolve(result);
    else call.reject(new Error(error));
  };
  // A worker-level crash (e.g. the wasm failed to load at all) has no `id`
  // to route to a specific call -- fail every call still waiting rather
  // than leaving them hanging forever.
  worker.onerror = (event) => {
    for (const call of pending.values()) call.reject(new Error(event.message));
    pending.clear();
  };
  return worker;
}

function callWorker(type, payload, transfer) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, ...payload }, transfer);
  });
}

function isPdf(file) {
  return file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
}

// A modern phone photo can be 12+ megapixels -- far more detail than
// printed receipt text needs, and OCR inference cost scales with pixel
// count. Capping the long side before it ever reaches the worker (or the
// canvas readback below) cuts both the postMessage payload and the
// actual compute; small images pass through untouched.
const MAX_IMAGE_DIMENSION = 1800;

// Browser-native decode: draws the file into an offscreen canvas and
// reads back raw pixels. Not a library -- the same category of host call
// as the `FileReader` the CSV importer already uses, just for pixels
// instead of text. The alpha channel is stripped since the OCR models
// take plain RGB.
async function imageToRgb(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const rgb = new Uint8Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return { rgb, width, height };
}

/**
 * Extracts plain text from a picked receipt file: `pdf-extract` (Rust)
 * for a PDF's text layer, `ocrs-cjk` (Rust) for a photographed receipt.
 * Neither path uploads the file anywhere -- both run entirely against
 * bytes already local to this tab.
 *
 * A PDF with no text layer (a scanned image saved as a PDF) is a known
 * v1 gap -- see the plan addendum for why rasterizing it has no clean
 * Rust answer -- and is reported as `pdfNotSupported` rather than
 * silently returning nothing.
 */
export async function extractReceiptText(file) {
  if (isPdf(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await callWorker('pdf', { bytes }, [bytes.buffer]);
    if (result?.error) return { text: '', calcError: result };
    if (!result.text.trim()) {
      return { text: '', calcError: { error: 'pdfNotSupported', error_message: { code: 'transactions.receiptPdfNotSupported', params: {}, text: '' } } };
    }
    return { text: result.text, calcError: null };
  }

  const { rgb, width, height } = await imageToRgb(file);
  const result = await callWorker('ocr', { imageRgb: rgb, width, height }, [rgb.buffer]);
  if (result?.error) return { text: '', calcError: result };
  return { text: result.text, calcError: null };
}
