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
// Resolved against this worker's own runtime location (`self.location`),
// not a root-relative or page-relative path: a leading `/ocr/...` broke
// in production because GitHub Pages serves this app from a subpath
// (/budget_planner/, not domain root) -- root-relative landed one level
// too high and 404'd, invisibly on localhost since that's served at
// actual root. This worker's compiled chunk and the ocr/ static folder
// both land in the same output directory (see webpack.config.js), so a
// path relative to the worker's real final URL lands correctly
// regardless of what subpath the site as a whole is served under.
//
// Deliberately `self.location.href`, not `import.meta.url`: webpack 5
// treats `new URL(literal, import.meta.url)` as a static asset import
// and tries to bundle whatever the literal names -- the .rten files
// aren't part of the module graph (they're copied from static/ by
// CopyWebpackPlugin, not imported), so that pattern fails the build
// outright rather than just resolving wrong at runtime. `self.location`
// is a plain runtime value webpack has no reason to inspect.
const OCR_MODEL_PATHS = {
  detection: new URL('ocr/text-detection.rten', self.location.href),
  recognition: new URL('ocr/text-recognition.rten', self.location.href),
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
