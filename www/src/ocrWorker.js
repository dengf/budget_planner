// Runs receipt OCR, PDF text extraction, and statement-row income/expense
// classification off the main thread.
//
// Several independent wasm modules -- `budget-wasm-ocr`, `budget-wasm-pdf`,
// `budget-wasm-pdfrender`, `budget-wasm-llm` and Smart Parse's own
// `budget-wasm-glmocr-vision`/`-embed`/`-decoder`/`-orchestrate` -- each
// `import()`ed lazily and only the first time its own message type
// actually arrives -- a photo scan never triggers the `pkg-pdf` or
// `pkg-llm` download, a PDF upload never triggers `pkg-ocr`'s (which
// carries the `ocrs-cjk`/`rten` ML runtime), and a statement whose rows
// all carry an explicit sign or CR/DB marker never triggers `pkg-llm`'s
// at all. OCR and PDF used to be one combined module; splitting them
// stopped either path paying for the other's weight -- see
// budget-wasm-ocr/src/lib.rs, budget-wasm-pdf/src/lib.rs and
// budget-wasm-llm/src/lib.rs for the measured sizes.
//
// Smart Parse's own four modules are a *second* reason for the split
// beyond download size: each of GLM-OCR's three ONNX models needs its
// own independent wasm linear memory, not just its own download, because
// `rten` (the ONNX runtime these bindings use) eagerly upconverts every
// fp16 weight to a fresh f32 buffer at load time -- three ~2.2GB-fp16
// models sharing one wasm32 module's 4GiB linear-memory ceiling exceeded
// it by construction, confirmed as the cause of a real iPhone crash. See
// budget-wasm-glmocr-vision/src/lib.rs for the full writeup, and
// `runSmartParseGeneration` below for how the generation loop that used
// to live in Rust as `budget_calc::smart_parse::SmartParseSession::run`
// now lives here instead -- separate wasm module instances cannot call
// each other directly, only JS can sequence calls across them.
//
// That fix addressed wasm32's own 4GiB-per-module ceiling, but left a
// second, lower ceiling standing: all three module instances still share
// this one worker's OS-level process, and their doubled memory adds up
// there regardless of how many separate wasm32 address spaces they
// occupy -- roughly 4.2GB combined, comfortably past a real iPhone's
// actual per-tab memory budget, confirmed as the cause of a second
// real-device failure (the tab silently reset with no JS-visible error at
// all -- an OS-level memory kill, not a catchable exception). Vision is
// only ever needed once per scan, so it runs in its own dedicated worker,
// terminated immediately after -- see `runVisionInSubworker` and
// `glmVisionWorker.js`'s own doc comment.
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

// Smart Parse's own fetch/cache/retry helpers and model paths live in
// `glmOcrFetch.js`, shared with `glmVisionWorker.js` -- see that file's
// own doc comment for why vision runs in a separate, dedicated worker
// rather than loading here alongside embed/decoder the way it used to.
import {
  GLM_OCR_MODEL_PATHS,
  fetchBytesCached,
  fetchDataFileIntoSession,
  throwIfLoadError,
  isMessageShaped,
} from './glmOcrFetch';

let ocrWasmPromise = null;
let pdfWasmPromise = null;
let pdfRenderWasmPromise = null;
let llmWasmPromise = null;
let glmEmbedWasmPromise = null;
let glmDecoderWasmPromise = null;
let glmOrchestrateWasmPromise = null;
let modelBytesPromise = null;
let llmModelBytesPromise = null;
let glmOcrModelsPromise = null;

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

// `wasm.default()`'s *return value* is the raw wasm instance's exports
// object -- the one with `.memory` on it (see each `pkg-glmocr-*`
// package's own generated glue: `wasm.memory.buffer` there refers to
// this object, set via `wasm = instance.exports` inside `__wbg_finalize_init`).
// The `import()`ed module namespace (`wasm` below, before this fix) never
// re-exports `memory` at all, so reading `.memory` straight off it was
// always `undefined` -- confirmed on a real repro where the pre-crash
// memory sample stayed `null` even before any trap could have made it
// unreadable. `exports` is attached onto the returned object so
// `taggedModelLoadError`/`sampleMemoryBeforeEachChunk` can read
// `<wasm>.exports.memory.buffer` instead of the module namespace.
function loadGlmEmbedWasm() {
  if (!glmEmbedWasmPromise) {
    glmEmbedWasmPromise = import('../pkg-glmocr-embed').then(async (wasm) => {
      const exports = wasm.default ? await wasm.default() : undefined;
      return { ...wasm, exports };
    });
  }
  return glmEmbedWasmPromise;
}

function loadGlmDecoderWasm() {
  if (!glmDecoderWasmPromise) {
    glmDecoderWasmPromise = import('../pkg-glmocr-decoder').then(async (wasm) => {
      const exports = wasm.default ? await wasm.default() : undefined;
      return { ...wasm, exports };
    });
  }
  return glmDecoderWasmPromise;
}

function loadGlmOrchestrateWasm() {
  if (!glmOrchestrateWasmPromise) {
    glmOrchestrateWasmPromise = import('../pkg-glmocr-orchestrate').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return glmOrchestrateWasmPromise;
}

// Same one-fetch-per-worker-lifetime memoization as `loadModels` above,
// for embed, decoder and the tokenizer -- `onProgress(loadedBytes)` is
// called with the running total as they stream in, so a caller can show
// real download progress rather than a UI that looks frozen for however
// long a multi-hundred-MB fetch takes. Only called once per worker
// lifetime even if `onProgress` differs between callers (a second Smart
// Parse call while the first is still loading shares the same in-flight
// promise but won't see progress events -- acceptable, since Smart
// Parse's own UI disables re-triggering while a parse is in flight).
// Memoizes the fully-loaded model objects, not raw bytes -- a second
// Smart Parse call in the same worker lifetime reuses them directly,
// without re-fetching or re-parsing either model.
//
// Vision is deliberately NOT loaded or memoized here -- see
// `runVisionInSubworker` below and `glmVisionWorker.js`'s own doc comment
// for why it runs in its own, separately-terminated worker instead:
// embed (~0.35GB doubled) and decoder (~2.2GB doubled, before its
// KV-cache even starts growing) both need to stay resident for the whole
// generation loop, but vision (~1.65GB doubled) is only ever called once,
// right at the start, and holding all three simultaneously reliably
// exceeds a real iPhone's actual per-tab memory budget even though no
// single wasm32 module ever approaches its own 4GiB ceiling.
//
// Sequential, deliberately not concurrent -- downloading both files at
// once meant two buffers resident simultaneously, and decoder's own file
// alone is over 1GB, which combined with embed's was enough overhead on
// its own to matter on a real device.
//
// Each large file's bytes arrive via `fetchDataFileIntoSession`'s
// tens-of-MB range requests, handed to `session.append_data_chunk` one
// chunk at a time and finished with `session.finish`, rather than this
// worker ever assembling the whole file as one JS buffer -- a single such
// buffer crossing the JS/wasm boundary in one call was, on its own,
// enough to crash a real phone's tab (confirmed on a brand-new, high-RAM
// iPhone, in both Safari and Chrome, with only one tab open). Chunking
// bounds every single buffer this worker or `budget_calc::smart_parse_model`
// ever handles in one call to tens of MB, regardless of how large the
// overall model file is.
//
// Reset to null on rejection, same reasoning as loadModels above but far
// more likely to matter here: this download takes minutes even on a fast
// connection, and mobile browsers routinely interrupt a long fetch
// (screen lock, backgrounding, switching between wifi and cellular).
// Without the reset, that first interruption would permanently wedge
// Smart Parse until a full page reload. The shared `glmOcrFetch.js`
// helpers both check Cache Storage before fetching, so a retry after this
// reset only re-fetches whatever chunk was in flight when the
// interruption hit, not the whole download.
// `track(delta)` is a shared accumulator owned by the caller (see the
// `'smart-parse'` case in `self.onmessage` below) rather than built
// locally here -- `runVisionInSubworker`'s own download progress needs to
// fold into the same running total this function's embed/decoder/
// tokenizer downloads report into, since vision (unlike those three) is
// never memoized and re-reports progress on every single call.
// Tags which of GLM-OCR's models was loading when a failure happened, and
// that module's actual wasm linear memory size at that exact moment --
// via `wasm.exports.memory.buffer` (see `loadGlmEmbedWasm`/
// `loadGlmDecoderWasm`'s own doc comment for why it's `.exports.memory`
// and not just `.memory`), a plain JS property read rather than a call
// back into wasm, so it's safe even right after a trap in that same
// module. This is the same question this repo's own PR #51 needed a
// temporary Rust-side `wasm_memory_bytes()` export and manual Console.app
// watching to answer for the vision+embed+decoder crash that led to
// splitting them into separate modules -- reading the wasm instance's own
// already-exported `memory` gets the same number for free, and
// `receiptFailureBreadcrumb.js` persists it, so a real-device repro
// doesn't need a live console attached at all.
// `lastKnownMemoryBytes` is a pre-crash fallback -- see
// `sampleMemoryBeforeEachChunk` below -- for exactly the case a real
// repro already hit: a genuine trap can leave a module's own
// `memory.buffer` unreadable afterwards (confirmed on a real device,
// where this direct read came back empty both times), so the size
// sampled right before the fatal chunk was attempted is the only number
// left to report.
function taggedModelLoadError(err, stage, wasm, lastKnownMemoryBytes) {
  const tagged = err instanceof Error ? err : new Error(String(err));
  tagged.smartParseStage = stage;
  try {
    tagged.smartParseWasmMemoryBytes = wasm.exports.memory.buffer.byteLength;
  } catch {
    tagged.smartParseWasmMemoryBytes = lastKnownMemoryBytes ?? null;
  }
  return tagged;
}

// Acks for `checkpointBeforeChunk` below, keyed by the `checkpointId` this
// worker minted when it sent the checkpoint -- `self.onmessage` resolves
// the matching entry the moment `receiptCapture.js` confirms the write
// landed in `localStorage` (this worker has no storage access of its own).
let nextCheckpointId = 1;
const pendingCheckpointAcks = new Map();

// Samples `wasm.exports.memory.buffer.byteLength` into `sample.bytes` and
// posts it to the main thread as a checkpoint, then *awaits the main
// thread's ack* before letting the caller proceed to whatever risky step
// comes next -- a chunk append (passed as `fetchDataFileIntoSession`'s
// `onBeforeChunk` hook, stage `'embed'`/`'decoder'`) or a model's own
// `finish()` call (invoked directly, stage `'embed-finish'`/
// `'decoder-finish'`) -- either of which might trap or, worse, hard-crash
// the whole tab with no catchable exception at all (see
// `recordReceiptCheckpoint`'s own doc comment for why that case needs more
// than `taggedModelLoadError`'s after-the-fact tagging). The `-finish`
// checkpoints exist because `begin_data` reserves a model's *entire*
// buffer upfront (`Vec::with_capacity`, see `smart_parse_model.rs`), so a
// chunk-append checkpoint's `wasmMemoryBytes` plateaus almost immediately
// and stays flat regardless of how much of the file has actually
// downloaded -- it can't tell a crash during the download apart from one
// during `finish()`'s own `rten` graph construction, which is real,
// separate allocation work the chunk checkpoints have no visibility into.
// `sample.bytes` still feeds the catchable-trap fallback too, for the
// ordinary case this worker already handled before.
function checkpointBeforeChunk(id, stage, wasm, sample) {
  return () => {
    try {
      sample.bytes = wasm.exports.memory.buffer.byteLength;
    } catch {
      // Leave the previous sample in place; still better than nothing.
    }
    return new Promise((resolve) => {
      const checkpointId = nextCheckpointId++;
      pendingCheckpointAcks.set(checkpointId, resolve);
      self.postMessage({ id, checkpointId, checkpoint: { stage, wasmMemoryBytes: sample.bytes } });
    });
  };
}

function loadGlmOcrModels(track, id) {
  if (!glmOcrModelsPromise) {
    glmOcrModelsPromise = (async () => {
      const [embedWasm, decoderWasm, orchestrate] = await Promise.all([
        loadGlmEmbedWasm(),
        loadGlmDecoderWasm(),
        loadGlmOrchestrateWasm(),
      ]);

      const embed = new embedWasm.TokenEmbedder();
      const embedMemorySample = { bytes: null };
      try {
        await fetchDataFileIntoSession(
          embed,
          GLM_OCR_MODEL_PATHS.embedData,
          track,
          checkpointBeforeChunk(id, 'embed', embedWasm, embedMemorySample),
        );
        await checkpointBeforeChunk(id, 'embed-finish', embedWasm, embedMemorySample)();
        throwIfLoadError(embed.finish());
      } catch (err) {
        throw taggedModelLoadError(err, 'embed', embedWasm, embedMemorySample.bytes);
      }

      const decoder = new decoderWasm.DecoderSession();
      const decoderMemorySample = { bytes: null };
      try {
        const graph = await fetchBytesCached(GLM_OCR_MODEL_PATHS.decoderGraph, track);
        await fetchDataFileIntoSession(
          decoder,
          GLM_OCR_MODEL_PATHS.decoderData,
          track,
          checkpointBeforeChunk(id, 'decoder', decoderWasm, decoderMemorySample),
        );
        await checkpointBeforeChunk(id, 'decoder-finish', decoderWasm, decoderMemorySample)();
        throwIfLoadError(decoder.finish(graph));
      } catch (err) {
        throw taggedModelLoadError(err, 'decoder', decoderWasm, decoderMemorySample.bytes);
      }

      const tokenizerJson = await fetchBytesCached(GLM_OCR_MODEL_PATHS.tokenizer, track);
      return { embed, decoder, orchestrate, tokenizerJson };
    })().catch((err) => {
      glmOcrModelsPromise = null;
      throw err;
    });
  }
  return glmOcrModelsPromise;
}

// Runs vision encoding in its own dedicated worker, spawned fresh and
// terminated the moment it settles (success or failure) -- see
// `glmVisionWorker.js`'s own doc comment for the full reasoning. `track`
// is the same running-total accumulator `loadGlmOcrModels` above uses,
// so vision's download progress (re-fetched from Cache Storage on every
// call, since vision is never memoized) folds into the same progress
// total the caller already reports.
function runVisionInSubworker(pixelValues, gridH, gridW, track) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./glmVisionWorker.js', import.meta.url));
    const settle = (fn, arg) => {
      worker.terminate();
      fn(arg);
    };
    worker.onmessage = (event) => {
      const { progress, ok, imageFeatures, error } = event.data;
      if (progress) {
        track(progress.loadedBytes);
        return;
      }
      if (ok) settle(resolve, imageFeatures);
      else settle(reject, isMessageShaped(error) ? error : new Error(error));
    };
    worker.onerror = (event) => settle(reject, new Error(event.message));
    worker.postMessage({ pixelValues, gridH, gridW }, [pixelValues.buffer]);
  });
}

// Runs GLM-OCR's full text-recognition pipeline over one image: resize +
// patchify, vision encoder, chat-template + mrope position ids, token
// embedding (with image features spliced into the image-token
// positions), then a greedy-decoded, KV-cached generation loop until
// end-of-sequence or `orchestrate.max_new_tokens()`. This is the control
// flow that used to live in Rust as
// `budget_calc::smart_parse::SmartParseSession::run` -- moved here
// because `vision`/`embed`/`decoder` are three separate wasm module
// instances (see `loadGlmOcrModels` and `runVisionInSubworker` above)
// that cannot call each other directly; only JS can sequence calls across
// them. Every actual calculation stays in Rust, individually unit-tested
// in `budget_calc::smart_parse_orchestrate` -- this loop only decides
// which model to call next and shuttles buffers between them.
async function runSmartParseGeneration(models, imageRgb, width, height, track) {
  const { embed, decoder, orchestrate, tokenizerJson } = models;

  // Clears the decoder's internal KV cache -- required before every new
  // image's generation, or this call would silently continue a previous
  // image's cache instead of starting fresh (wrong output, not a crash;
  // see budget-wasm-glmocr-decoder/src/lib.rs's own doc comment).
  decoder.reset();

  const [gridH, gridW] = orchestrate.patch_grid(width, height);
  const pixelValues = orchestrate.patchify(imageRgb, width, height);
  const imageFeatures = await runVisionInSubworker(pixelValues, gridH, gridW, track);

  const hiddenSize = orchestrate.hidden_size();
  const numImageTokens = imageFeatures.length / hiddenSize;
  const inputIds = orchestrate.build_input_ids(tokenizerJson, numImageTokens);
  let positionIds = orchestrate.rope_index(inputIds, gridH, gridW);

  let embeds = embed.embed(inputIds);
  orchestrate.splice_image_features(embeds, imageFeatures, inputIds);

  let curSeqLen = inputIds.length;
  const attentionMask = new Array(curSeqLen).fill(1);
  const maxNewTokens = orchestrate.max_new_tokens();
  const generated = [];

  for (let step = 0; step < maxNewTokens; step++) {
    const logits = decoder.step(embeds, curSeqLen, attentionMask, positionIds);
    const nextId = orchestrate.argmax(logits);
    if (orchestrate.is_eos(nextId)) break;
    generated.push(nextId);

    positionIds = orchestrate.advance_position_ids(positionIds, curSeqLen);
    curSeqLen = 1;
    attentionMask.push(1);
    embeds = embed.embed([nextId]);
  }

  return orchestrate.decode_tokens(tokenizerJson, generated);
}

self.onmessage = async (event) => {
  // An ack for `checkpointBeforeChunk` above, not a dispatchable call --
  // resolves the matching pending checkpoint and returns before touching
  // `type` at all, since this message shape has none.
  if (event.data?.checkpointAck != null) {
    pendingCheckpointAcks.get(event.data.checkpointAck)?.();
    pendingCheckpointAcks.delete(event.data.checkpointAck);
    return;
  }
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
      let loaded = 0;
      const track = (delta) => {
        loaded += delta;
        self.postMessage({ id, progress: { loadedBytes: loaded } });
      };
      const models = await loadGlmOcrModels(track, id);
      const { imageRgb, width, height } = event.data;
      try {
        result = { text: await runSmartParseGeneration(models, imageRgb, width, height, track) };
      } catch (genError) {
        // A thrown `Message` (see `isMessageShaped` above) is a known
        // calc failure -- normalize it back into the same
        // `{ text, error, error_message }` shape every other calc-error
        // path in this app already resolves with (rather than rejecting
        // the whole call), so `receiptCapture.js`/`CalcError` handle it
        // identically regardless of which OCR engine produced it.
        if (!isMessageShaped(genError)) throw genError;
        result = { text: '', error: genError.text, error_message: genError };
      }
    } else {
      throw new Error(`ocrWorker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result }, transfer ?? []);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error?.message ?? String(error),
      // Only ever set for a 'smart-parse' failure during model loading --
      // see `taggedModelLoadError` above. Passed through untouched so
      // `receiptCapture.js`/`receiptFailureBreadcrumb.js` can persist
      // exactly which model was loading and how large its wasm linear
      // memory had grown, without this worker knowing anything about how
      // that ends up displayed or stored.
      stage: error?.smartParseStage ?? null,
      wasmMemoryBytes: error?.smartParseWasmMemoryBytes ?? null,
    });
  }
};
