// Runs receipt OCR, PDF text extraction, and statement-row income/expense
// classification off the main thread.
//
// Several independent wasm modules -- `budget-wasm-ocr`, `budget-wasm-pdf`,
// `budget-wasm-pdfrender` and `budget-wasm-llm` -- each `import()`ed lazily
// and only the first time its own message type actually arrives -- a photo
// scan never triggers the `pkg-pdf` or `pkg-llm` download, a PDF upload
// never triggers `pkg-ocr`'s (which carries the `ocrs-cjk`/`rten` ML
// runtime), and a statement whose rows all carry an explicit sign or
// CR/DB marker never triggers `pkg-llm`'s at all. OCR and PDF used to be
// one combined module; splitting them stopped either path paying for the
// other's weight -- see budget-wasm-ocr/src/lib.rs, budget-wasm-pdf/src/lib.rs
// and budget-wasm-llm/src/lib.rs for the measured sizes.
//
// `pkg-pdfrender` (`hayro`, a pure-Rust PDF rasterizer) is reached from two
// messages -- `'pdf-page-count'` and `'pdf-render-page'` -- both used only
// by a scanned PDF with no text layer falling back to it from the plain
// OCR path. A text-layer-only PDF session never downloads it.
//
// Both bindings are synchronous Rust calls -- a real scan blocked the
// entire tab for 20-40+ seconds on ordinary hardware (worse on a phone),
// reported live: no scrolling, no clicks, no repaint, the whole page
// looked crashed even though it was still working. Wasm-bindgen's
// `--target web` glue works identically inside a Worker (fetch and wasm
// instantiation are both available here), so this file is the whole
// main/worker boundary: `receiptCapture.js` posts bytes in, this posts
// text back, and the main thread stays responsive throughout.
//
// `parse_receipt_text` is deliberately NOT handled here -- it's plain
// text parsing with no heavy dependency, bound instead in the
// always-loaded core module and called directly from the main thread
// (see `ReceiptCapture.jsx`). Routing it through this worker would have
// meant loading whichever of the two lazy modules happened to have it,
// for no benefit.
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
  detection: new URL('ocr/ppocrv6-tiny-det.rten', self.location.href),
  recognition: new URL('ocr/ppocrv6-tiny-rec.rten', self.location.href),
};

// Same resolve-against-the-worker's-own-URL reasoning as OCR_MODEL_PATHS
// above -- a `llm/` static folder alongside `ocr/`, fetched only the
// first time a statement row actually needs classifying (see
// `ReceiptCapture.jsx`: most statements have an explicit sign or a
// CR/DB marker on every row and never reach this path at all).
const LLM_MODEL_PATHS = {
  model: new URL('llm/all-MiniLM-L6-v2.onnx', self.location.href),
  tokenizer: new URL('llm/tokenizer.json', self.location.href),
};

let ocrWasmPromise = null;
let pdfWasmPromise = null;
let pdfRenderWasmPromise = null;
let llmWasmPromise = null;
let modelBytesPromise = null;
let llmModelBytesPromise = null;

async function fetchBytes(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`could not fetch ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function loadOcrWasm() {
  if (!ocrWasmPromise) {
    ocrWasmPromise = import('../pkg-ocr').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return ocrWasmPromise;
}

function loadPdfWasm() {
  if (!pdfWasmPromise) {
    pdfWasmPromise = import('../pkg-pdf').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return pdfWasmPromise;
}

function loadPdfRenderWasm() {
  if (!pdfRenderWasmPromise) {
    pdfRenderWasmPromise = import('../pkg-pdfrender').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return pdfRenderWasmPromise;
}

function loadLlmWasm() {
  if (!llmWasmPromise) {
    llmWasmPromise = import('../pkg-llm').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return llmWasmPromise;
}

// Fetched once per worker lifetime -- a second scan in the same session
// shouldn't re-download the ~6.3MB of model data again. Reset to null on
// rejection so a dropped connection (flaky wifi, phone briefly offline)
// doesn't permanently poison every later attempt with the same stale
// rejected promise -- without this, only a full page reload (which
// re-creates the worker) could recover.
function loadModels() {
  if (!modelBytesPromise) {
    modelBytesPromise = Promise.all([
      fetchBytes(OCR_MODEL_PATHS.detection),
      fetchBytes(OCR_MODEL_PATHS.recognition),
    ]).catch((err) => {
      modelBytesPromise = null;
      throw err;
    });
  }
  return modelBytesPromise;
}

// Same one-fetch-per-worker-lifetime memoization (and reset-on-rejection,
// see loadModels above) as loadModels, for the ~23MB embedding model +
// its tokenizer.
function loadLlmModel() {
  if (!llmModelBytesPromise) {
    llmModelBytesPromise = Promise.all([
      fetchBytes(LLM_MODEL_PATHS.model),
      fetchBytes(LLM_MODEL_PATHS.tokenizer),
    ]).catch((err) => {
      llmModelBytesPromise = null;
      throw err;
    });
  }
  return llmModelBytesPromise;
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    let result;
    let transfer; // only 'pdf-render-page' below has a buffer worth transferring back
    if (type === 'ocr') {
      const wasm = await loadOcrWasm();
      const [detectionModel, recognitionModel] = await loadModels();
      const { imageRgb, width, height } = event.data;
      result = wasm.run_ocr(detectionModel, recognitionModel, imageRgb, width, height);
    } else if (type === 'pdf') {
      const wasm = await loadPdfWasm();
      result = wasm.extract_pdf_text(event.data.bytes);
    } else if (type === 'pdf-page-count') {
      const wasm = await loadPdfRenderWasm();
      result = wasm.pdf_page_count(event.data.bytes);
    } else if (type === 'pdf-render-page') {
      const wasm = await loadPdfRenderWasm();
      // `render_pdf_page` returns a plain `Vec<u8>`, not the usual
      // `to_js`-wrapped result object -- see budget-wasm-pdfrender's own
      // doc comment for why: a rendered page is several megabytes, and
      // wasm-bindgen only gets the cheap, native `Uint8Array` conversion
      // for a raw `Vec<u8>` return type, not one buried in a serialized
      // struct field. An empty buffer is the failure sentinel (bad page
      // index, or a page with no visible area); everything else is an
      // 8-byte little-endian `[width, height]` header followed by the
      // RGB pixels themselves.
      const packed = wasm.render_pdf_page(event.data.bytes, event.data.pageIndex);
      if (packed.length === 0) {
        result = { width: 0, height: 0, rgb: new Uint8Array(0) };
      } else {
        const header = new DataView(packed.buffer, packed.byteOffset, 8);
        result = {
          width: header.getUint32(0, true),
          height: header.getUint32(4, true),
          rgb: new Uint8Array(packed.buffer, packed.byteOffset + 8, packed.length - 8),
        };
        transfer = [packed.buffer];
      }
    } else if (type === 'llm') {
      const wasm = await loadLlmWasm();
      const [modelBytes, tokenizerJson] = await loadLlmModel();
      result = wasm.classify_statement_rows(modelBytes, tokenizerJson, event.data.descriptions);
    } else {
      throw new Error(`ocrWorker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result }, transfer ?? []);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};
