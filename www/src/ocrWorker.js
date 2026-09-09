// Runs receipt OCR, PDF text extraction, and statement-row income/expense
// classification off the main thread.
//
// Several independent wasm modules -- `budget-wasm-ocr`, `budget-wasm-pdf`,
// `budget-wasm-pdfrender`, `budget-wasm-llm` and `budget-wasm-glmocr` --
// each `import()`ed lazily and only the first time its own message type
// actually arrives -- a photo scan never triggers the `pkg-pdf` or
// `pkg-llm` download, a PDF upload never triggers `pkg-ocr`'s (which
// carries the `ocrs-cjk`/`rten` ML runtime), and a statement whose rows
// all carry an explicit sign or CR/DB marker never triggers `pkg-llm`'s
// at all. OCR and PDF used to be one combined module; splitting them
// stopped either path paying for the other's weight -- see
// budget-wasm-ocr/src/lib.rs, budget-wasm-pdf/src/lib.rs and
// budget-wasm-llm/src/lib.rs for the measured sizes.
//
// `pkg-pdfrender` (`hayro`, a pure-Rust PDF rasterizer) is the one
// exception to "one message type per module": both the `'pdf-page-count'`
// and `'pdf-render-page'` messages load it, and it's reached from two
// different callers in `receiptCapture.js` -- a scanned PDF with no text
// layer falling back to it from the plain OCR path, and any PDF page at
// all when Smart Parse is turned on, since GLM-OCR only reads pixels.
// Neither a text-layer-only PDF session nor an image-only session ever
// downloads it.
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
// v2, not v1: v1 cached each of the three large external-data files as
// one whole-file Cache Storage entry; v2 caches them in
// `GLM_OCR_CHUNK_BYTES`-sized pieces instead (see `fetchDataChunkCached`
// below), a different enough key shape that reusing the old name would
// just leave v1's whole-file entries as permanent dead weight never read
// again. The browser will evict `v1` under normal storage-pressure
// eviction like any other stale cache.
const GLM_OCR_CACHE_NAME = 'smart-parse-glm-ocr-v2';

// Each of GLM-OCR's three external-data (weights) files is fetched in
// pieces this large via HTTP Range requests, rather than as one
// streamed response -- see `loadGlmOcrSession`'s own doc comment for
// why. Hugging Face's model CDN confirmed to honor `Range` with a real
// `206 Partial Content` + `Content-Range` response before this was
// built on that assumption.
const GLM_OCR_CHUNK_BYTES = 32 * 1024 * 1024;

let ocrWasmPromise = null;
let pdfWasmPromise = null;
let pdfRenderWasmPromise = null;
let llmWasmPromise = null;
let glmOcrWasmPromise = null;
let modelBytesPromise = null;
let llmModelBytesPromise = null;
let glmOcrSessionPromise = null;

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
//
// Writes straight into one pre-sized buffer (from the response's own
// `Content-Length` -- Hugging Face's CDN always sends one for these
// files) rather than an array of chunks concatenated at the end, and
// caches from that finished buffer rather than a `clone()`'d stream
// buffered concurrently by the Cache API. The old version did both at
// once per file -- a chunks array, a final concatenated copy, and a
// second full buffer inside `cache.put`'s own stream handling -- close
// to 3x a file's size resident at once. With the two largest of GLM-OCR's
// seven files around 900MB and 1.1GB, downloading all seven at once (see
// below) with that per-file overhead was enough to crash the whole tab
// partway through a real download, reported live at roughly 50% of the
// combined ~2.2GB. Falls back to the old chunks-then-concat approach only
// if a response is ever served without a usable `Content-Length`.
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
  const reader = res.body.getReader();
  const declaredLength = Number(res.headers.get('content-length'));

  let bytes;
  if (Number.isFinite(declaredLength) && declaredLength > 0) {
    bytes = new Uint8Array(declaredLength);
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value, offset);
      offset += value.byteLength;
      onChunk(value.byteLength);
    }
  } else {
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      onChunk(value.byteLength);
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }

  cache.put(url, new Response(bytes)).catch(() => {}); // best-effort; quota errors shouldn't fail the parse itself
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

function loadGlmOcrWasm() {
  if (!glmOcrWasmPromise) {
    glmOcrWasmPromise = import('../pkg-glmocr').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return glmOcrWasmPromise;
}

// Discovers a file's total byte length via a HEAD request, without
// downloading any of the body -- used only for the three large
// external-data files, to know how many `GLM_OCR_CHUNK_BYTES` range
// requests to issue and how large a buffer `SmartParseSession.begin_data`
// should reserve.
async function fetchContentLength(url) {
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) throw new Error(`could not HEAD ${url}: ${res.status}`);
  const length = Number(res.headers.get('content-length'));
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error(`${url} did not report a usable Content-Length`);
  }
  return length;
}

// Fetches one `GLM_OCR_CHUNK_BYTES`-sized (or smaller, for the last
// piece) range of `url`, checking Cache Storage first under a
// per-chunk key -- a prior interrupted download that already cached
// some chunks skips straight past them on retry, same resumability
// `fetchBytesCached` gets from whole-file caching, just at a finer
// grain (and, unlike whole-file caching, no partial progress is ever
// lost to an interruption beyond the one chunk in flight when it hit).
//
// The write to Cache Storage is awaited before this function returns,
// deliberately giving up the overlap a fire-and-forget `cache.put` would
// allow between one chunk's disk write and the next chunk's network
// fetch. A first version left it fire-and-forget, the same way
// `fetchBytesCached` below writes its one whole-file entry -- fine
// there, since it happens once per file, but here it runs ~27 times per
// large file in quick succession, and a disk write slower than the next
// chunk's fetch (plausible on iOS's encrypted storage) let unfinished
// writes back up, each still holding its own chunk-sized buffer alive
// until it completed. That backlog was a new memory consumer this
// chunked rewrite introduced that the old whole-file streaming path
// never had, and it made a real device crash *earlier* than before this
// rewrite rather than later -- awaiting the write caps how many
// chunk-sized buffers can be alive for caching purposes at once to one.
async function fetchDataChunkCached(url, start, end) {
  const cache = await caches.open(GLM_OCR_CACHE_NAME);
  const chunkKey = `${url}#bytes=${start}-${end}`;
  const cached = await cache.match(chunkKey);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) {
    throw new Error(
      `expected a 206 Partial Content response to a ranged request for ${url}, got ${res.status}`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  try {
    await cache.put(chunkKey, new Response(bytes));
  } catch {
    // best-effort; a quota or storage error shouldn't fail the parse itself
  }
  return bytes;
}

// Fetches one of GLM-OCR's three external-data (weights) files in
// `GLM_OCR_CHUNK_BYTES`-sized HTTP range requests, handing each chunk to
// `session.append_data_chunk` as soon as it arrives -- see
// `loadGlmOcrSession`'s own doc comment for why this worker never
// materializes the whole file as one JS buffer at all, not even
// one-file-at-a-time.
// TEMPORARY: logs the wasm module's actual linear memory size (from
// `wasm_memory_bytes`, straight from the engine, not an estimate) at each
// step of loading -- part of the phone-crash investigation into whether
// this is a real crash inside WebKit's GC triggered by a
// `memory.grow()` call approaching wasm32's hard 4GiB linear-memory
// ceiling. A crash mid-download kills the tab before any return value
// makes it back to the main thread, but this log line itself reaches
// Console.app immediately, so the last one printed before a crash shows
// how close the heap actually got. Remove once that question is answered.
function logGlmOcrHeapSize(wasm, label) {
  const bytes = wasm.wasm_memory_bytes();
  console.log(`[SmartParse] wasm heap: ${(bytes / (1024 * 1024)).toFixed(1)}MB -- ${label}`);
}

async function fetchDataFileIntoSession(session, url, track, wasm) {
  const totalLength = await fetchContentLength(url);
  session.begin_data(totalLength);
  logGlmOcrHeapSize(wasm, `begin_data(${totalLength}) for ${url}`);
  for (let start = 0; start < totalLength; start += GLM_OCR_CHUNK_BYTES) {
    const end = Math.min(start + GLM_OCR_CHUNK_BYTES, totalLength) - 1;
    const chunk = await fetchDataChunkCached(url, start, end);
    session.append_data_chunk(chunk);
    track(chunk.byteLength);
    logGlmOcrHeapSize(wasm, `after chunk ${end + 1}/${totalLength} of ${url}`);
  }
}

// Same one-fetch-per-worker-lifetime memoization as `loadModels` above,
// at ~2.2GB instead of a few megabytes -- `onProgress(loadedBytes)` is
// called with the running total across all seven files as they stream
// in, so a caller can show real download progress rather than a UI that
// looks frozen for however long a 2.2GB fetch takes. Only called once
// per worker lifetime even if `onProgress` differs between callers
// (a second Smart Parse call while the first is still loading shares the
// same in-flight promise but won't see progress events -- acceptable,
// since Smart Parse's own UI disables re-triggering while a parse is in
// flight). Memoizes the fully-loaded `wasm.SmartParseSession`, not raw
// bytes -- a second Smart Parse call in the same worker lifetime reuses
// the already-built session directly, without re-fetching or re-parsing
// any of the three models.
//
// Sequential, deliberately not concurrent -- downloading all seven files
// at once meant up to seven buffers resident simultaneously, and with
// two of these files around 900MB and 1.1GB, that was enough on its own
// to crash the tab partway through a real download.
//
// Each large file's bytes also arrive via `fetchDataFileIntoSession`'s
// tens-of-MB range requests, handed to `session.append_data_chunk` one
// chunk at a time and finished with `session.finish_*`, rather than
// this worker ever assembling the whole ~868MB-to-1.1GB file as one JS
// buffer -- an earlier round already stopped collecting all three
// models' bytes before the first call into Rust (which fixed a crash
// from holding all ~2.2GB across all three files at once), but a single
// ~868MB-to-1.1GB buffer crossing the JS/wasm boundary in one call was
// still, on its own, enough to crash a real phone's tab -- confirmed on
// a brand-new, high-RAM iPhone, in both Safari and Chrome, with only one
// tab open, so neither a low-RAM device nor other tabs sharing memory
// explain it. `rten`'s own external-data storage doesn't duplicate the
// buffer either (confirmed against its source: a plain `Arc`-wrapped
// move). Chunking bounds every single buffer this worker or
// `budget_calc::SmartParseSession` ever handles in one call to tens of
// MB, regardless of how large the overall model file is, which rules
// out whatever below-the-model-loading-layer cost a single huge buffer
// was incurring, whatever it turns out to be.
//
// Reset to null on rejection, same reasoning as loadModels above but far
// more likely to matter here: a ~2.2GB download takes minutes even on a
// fast connection, and mobile browsers routinely interrupt a long fetch
// (screen lock, backgrounding, switching between wifi and cellular).
// Without the reset, that first interruption would permanently wedge
// Smart Parse until a full page reload. `fetchDataChunkCached` and
// `fetchBytesCached` both check Cache Storage before fetching, so a
// retry after this reset only re-fetches whatever chunk was in flight
// when the interruption hit, not the whole download.
function loadGlmOcrSession(onProgress) {
  if (!glmOcrSessionPromise) {
    let loaded = 0;
    const track = (delta) => {
      loaded += delta;
      onProgress(loaded);
    };
    glmOcrSessionPromise = (async () => {
      const wasm = await loadGlmOcrWasm();
      const session = new wasm.SmartParseSession();

      {
        const graph = await fetchBytesCached(GLM_OCR_MODEL_PATHS.visionGraph, track);
        await fetchDataFileIntoSession(session, GLM_OCR_MODEL_PATHS.visionData, track, wasm);
        throwIfLoadError(session.finish_vision(graph));
        logGlmOcrHeapSize(wasm, 'after finish_vision');
      }
      {
        const graph = await fetchBytesCached(GLM_OCR_MODEL_PATHS.embedGraph, track);
        await fetchDataFileIntoSession(session, GLM_OCR_MODEL_PATHS.embedData, track, wasm);
        throwIfLoadError(session.finish_embed(graph));
        logGlmOcrHeapSize(wasm, 'after finish_embed');
      }
      {
        const graph = await fetchBytesCached(GLM_OCR_MODEL_PATHS.decoderGraph, track);
        await fetchDataFileIntoSession(session, GLM_OCR_MODEL_PATHS.decoderData, track, wasm);
        throwIfLoadError(session.finish_decoder(graph));
        logGlmOcrHeapSize(wasm, 'after finish_decoder');
      }

      const tokenizerJson = await fetchBytesCached(GLM_OCR_MODEL_PATHS.tokenizer, track);
      return { session, tokenizerJson };
    })().catch((err) => {
      glmOcrSessionPromise = null;
      throw err;
    });
  }
  return glmOcrSessionPromise;
}

function throwIfLoadError(loadResult) {
  if (loadResult?.error) throw new Error(loadResult.error);
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
    } else if (type === 'smart-parse') {
      const { session, tokenizerJson } = await loadGlmOcrSession((loadedBytes) => {
        self.postMessage({ id, progress: { loadedBytes } });
      });
      const { imageRgb, width, height } = event.data;
      result = session.run(tokenizerJson, imageRgb, width, height);
    } else {
      throw new Error(`ocrWorker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result }, transfer ?? []);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};
