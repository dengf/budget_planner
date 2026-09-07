// Runs receipt OCR, PDF text extraction, and statement-row income/expense
// classification off the main thread.
//
// Three independent wasm modules, `budget-wasm-ocr`, `budget-wasm-pdf`
// and `budget-wasm-llm`, each `import()`ed lazily and only the first
// time its own message type actually arrives -- a photo scan never
// triggers the `pkg-pdf` or `pkg-llm` download, a PDF upload never
// triggers `pkg-ocr`'s (which is the larger of the two, since it
// carries the `ocrs-cjk`/`rten` ML runtime), and a statement whose rows
// all carry an explicit sign or CR/DB marker never triggers `pkg-llm`'s
// at all. OCR and PDF used to be one combined module; splitting them
// stopped either path paying for the other's weight -- see
// budget-wasm-ocr/src/lib.rs, budget-wasm-pdf/src/lib.rs and
// budget-wasm-llm/src/lib.rs for the measured sizes.
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

// Smart Parse's model, unlike every other one in this file, is not
// vendored under `static/` -- GLM-OCR's fp16 ONNX export is ~2.2GB
// across these six files, far beyond what's reasonable to check into
// git or download on an ordinary visit (see `budget-calc::smart_parse`'s
// own doc comment). Fetched directly from Hugging Face's model CDN only
// the first time a user explicitly opts into Smart Parse, and cached
// afterwards via `caches.open()` below (Cache Storage, not just the
// browser's ordinary HTTP cache) so a second use, even in a later
// session, doesn't re-download 2.2GB -- explicit control matters at this
// size, where an evicted HTTP cache silently turning into a re-download
// is a materially worse experience than for the other, much smaller
// models this worker fetches.
const GLM_OCR_BASE = 'https://huggingface.co/onnx-community/GLM-OCR-ONNX/resolve/main';
const GLM_OCR_MODEL_PATHS = {
  visionGraph: `${GLM_OCR_BASE}/onnx/vision_encoder_fp16.onnx`,
  visionData: `${GLM_OCR_BASE}/onnx/vision_encoder_fp16.onnx_data`,
  embedGraph: `${GLM_OCR_BASE}/onnx/embed_tokens_fp16.onnx`,
  embedData: `${GLM_OCR_BASE}/onnx/embed_tokens_fp16.onnx_data`,
  decoderGraph: `${GLM_OCR_BASE}/onnx/decoder_model_merged_fp16.onnx`,
  decoderData: `${GLM_OCR_BASE}/onnx/decoder_model_merged_fp16.onnx_data`,
  tokenizer: `${GLM_OCR_BASE}/tokenizer.json`,
};
const GLM_OCR_CACHE_NAME = 'smart-parse-glm-ocr-v1';

let ocrWasmPromise = null;
let pdfWasmPromise = null;
let llmWasmPromise = null;
let glmOcrWasmPromise = null;
let modelBytesPromise = null;
let llmModelBytesPromise = null;
let glmOcrModelBytesPromise = null;

async function fetchBytes(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`could not fetch ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Same as `fetchBytes`, plus: checks Cache Storage first (a prior Smart
// Parse download persists there across page loads, unlike an in-memory
// promise), and reports download progress via `onChunk(loadedDelta)` as
// bytes stream in -- the caller uses this to post incremental progress
// back to the main thread, since a single 2.2GB fetch with no feedback
// reads as a frozen/broken app on a slow connection.
async function fetchBytesCached(url, onChunk) {
  const cache = await caches.open(GLM_OCR_CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    const buf = await cached.arrayBuffer();
    onChunk(buf.byteLength);
    return new Uint8Array(buf);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
  // Cache a clone before consuming the body -- a `Response` can only be
  // read once, and the cache needs its own untouched copy.
  const toCache = res.clone();
  cache.put(url, toCache).catch(() => {}); // best-effort; quota errors shouldn't fail the parse itself

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    onChunk(value.byteLength);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
// shouldn't re-download the ~6.3MB of model data again.
function loadModels() {
  if (!modelBytesPromise) {
    modelBytesPromise = Promise.all([
      fetchBytes(OCR_MODEL_PATHS.detection),
      fetchBytes(OCR_MODEL_PATHS.recognition),
    ]);
  }
  return modelBytesPromise;
}

// Same one-fetch-per-worker-lifetime memoization as loadModels above, for
// the ~23MB embedding model + its tokenizer.
function loadLlmModel() {
  if (!llmModelBytesPromise) {
    llmModelBytesPromise = Promise.all([
      fetchBytes(LLM_MODEL_PATHS.model),
      fetchBytes(LLM_MODEL_PATHS.tokenizer),
    ]);
  }
  return llmModelBytesPromise;
}

function loadGlmOcrWasm() {
  if (!glmOcrWasmPromise) {
    glmOcrWasmPromise = import('../pkg-glmocr').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return glmOcrWasmPromise;
}

// Same one-fetch-per-worker-lifetime memoization as `loadModels` above,
// at ~2.2GB instead of a few megabytes -- `onProgress(loadedBytes)` is
// called with the running total across all six files as they stream in,
// so a caller can show real download progress rather than a UI that
// looks frozen for however long a 2.2GB fetch takes. Only called once
// per worker lifetime even if `onProgress` differs between callers
// (a second Smart Parse call while the first is still loading shares the
// same in-flight promise but won't see progress events -- acceptable,
// since Smart Parse's own UI disables re-triggering while a parse is in
// flight).
function loadGlmOcrModel(onProgress) {
  if (!glmOcrModelBytesPromise) {
    let loaded = 0;
    const track = (delta) => {
      loaded += delta;
      onProgress(loaded);
    };
    glmOcrModelBytesPromise = Promise.all([
      fetchBytesCached(GLM_OCR_MODEL_PATHS.visionGraph, track),
      fetchBytesCached(GLM_OCR_MODEL_PATHS.visionData, track),
      fetchBytesCached(GLM_OCR_MODEL_PATHS.embedGraph, track),
      fetchBytesCached(GLM_OCR_MODEL_PATHS.embedData, track),
      fetchBytesCached(GLM_OCR_MODEL_PATHS.decoderGraph, track),
      fetchBytesCached(GLM_OCR_MODEL_PATHS.decoderData, track),
      fetchBytesCached(GLM_OCR_MODEL_PATHS.tokenizer, track),
    ]);
  }
  return glmOcrModelBytesPromise;
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    let result;
    if (type === 'ocr') {
      const wasm = await loadOcrWasm();
      const [detectionModel, recognitionModel] = await loadModels();
      const { imageRgb, width, height } = event.data;
      result = wasm.run_ocr(detectionModel, recognitionModel, imageRgb, width, height);
    } else if (type === 'pdf') {
      const wasm = await loadPdfWasm();
      result = wasm.extract_pdf_text(event.data.bytes);
    } else if (type === 'llm') {
      const wasm = await loadLlmWasm();
      const [modelBytes, tokenizerJson] = await loadLlmModel();
      result = wasm.classify_statement_rows(modelBytes, tokenizerJson, event.data.descriptions);
    } else if (type === 'smart-parse') {
      const wasm = await loadGlmOcrWasm();
      const [visionGraph, visionData, embedGraph, embedData, decoderGraph, decoderData, tokenizerJson] =
        await loadGlmOcrModel((loadedBytes) => {
          self.postMessage({ id, progress: { loadedBytes } });
        });
      const { imageRgb, width, height } = event.data;
      result = wasm.run_smart_parse(
        visionGraph,
        visionData,
        embedGraph,
        embedData,
        decoderGraph,
        decoderData,
        tokenizerJson,
        imageRgb,
        width,
        height,
      );
    } else {
      throw new Error(`ocrWorker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};
