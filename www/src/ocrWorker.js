// Runs receipt OCR and PDF text extraction off the main thread.
//
// `budget-wasm-ocr`'s bindings are synchronous Rust calls -- a real scan
// blocked the entire tab for 20-40+ seconds on ordinary hardware (worse on
// a phone), reported live: no scrolling, no clicks, no repaint, the whole
// page looked crashed even though it was still working. Wasm-bindgen's
// `--target web` glue works identically inside a Worker (fetch and
// wasm instantiation are both available here), so this file is the whole
// main/worker boundary: `receiptCapture.js` posts bytes in, this posts
// text back, and the main thread stays responsive throughout.
//
// Root-relative paths (not the page-relative ones `receiptCapture.js`
// used when it ran on the main thread): a Worker's own script URL is its
// base for a relative fetch, not the page's, and this bundle can end up
// nested under a different path than the page depending on the build.

const OCR_MODEL_PATHS = {
  detection: '/ocr/text-detection.rten',
  recognition: '/ocr/text-recognition.rten',
};

let wasmPromise = null;
let modelBytesPromise = null;

async function fetchBytes(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`could not fetch ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = import('../pkg-ocr').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return wasmPromise;
}

// Fetched once per worker lifetime -- a second scan in the same session
// shouldn't re-download the ~12MB of model data again.
function loadModels() {
  if (!modelBytesPromise) {
    modelBytesPromise = Promise.all([
      fetchBytes(OCR_MODEL_PATHS.detection),
      fetchBytes(OCR_MODEL_PATHS.recognition),
    ]);
  }
  return modelBytesPromise;
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    const wasm = await loadWasm();
    let result;
    if (type === 'ocr') {
      const [detectionModel, recognitionModel] = await loadModels();
      const { imageRgb, width, height } = event.data;
      result = wasm.run_ocr(detectionModel, recognitionModel, imageRgb, width, height);
    } else if (type === 'pdf') {
      result = wasm.extract_pdf_text(event.data.bytes);
    } else if (type === 'parse') {
      result = wasm.parse_receipt_text(event.data.text);
    } else {
      throw new Error(`ocrWorker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};
