// Runs GLM-OCR's vision encoder (`budget-wasm-glmocr-vision`) in its own
// dedicated worker, spawned fresh by `ocrWorker.js`'s
// `runVisionInSubworker` and terminated immediately after this file's one
// `encode()` call returns.
//
// Splitting each of GLM-OCR's three ONNX models into its own wasm module
// (see budget-wasm-glmocr-vision/src/lib.rs's own doc comment) fixed a
// real iPhone crash caused by three ~2.2GB-fp16 models sharing one
// wasm32 module's 4GiB linear-memory ceiling. That fix left a second,
// lower ceiling standing: all three module instances still share the
// same OS-level process (one worker), and their memory adds up there
// regardless of how many separate wasm32 address spaces they occupy.
// Vision's ~828MB-fp16 weights double to ~1.65GB once `rten` upconverts
// them to f32 at load time; embed's ~174MB doubles to ~0.35GB; decoder's
// ~1.1GB doubles to ~2.2GB before its KV-cache even starts growing.
// Simultaneously resident, that's over 4GB before any JS-side buffers or
// the page's own overhead -- comfortably past a real iPhone's actual
// per-tab memory budget, confirmed as the cause of a real-device failure
// where the whole tab silently reset with no JS-visible error at all (an
// OS-level memory kill, not a catchable exception -- nothing was left for
// any `catch` block to see).
//
// Vision is only ever called once per scan; embed and decoder stay
// resident for the whole generation loop afterwards and can't be freed
// the same way. Dropping JS references to a loaded `VisionEncoder` and
// hoping the garbage collector reclaims its `WebAssembly.Memory` before
// the generation loop runs isn't reliable enough at this size --
// terminating the worker that instantiated it is the one deterministic
// way to force it released.
//
// A separate worker is a separate process, though, not a separate memory
// budget, and this file's own numbers above are what made that easy to
// forget: vision runs *after* `loadGlmOcrModels`, so embed and decoder
// are both still resident in `ocrWorker.js` while vision loads, and the
// tab's real peak is all three at once -- around 3.1GB on fp16, and the
// tab was being killed here, inside vision. With no checkpoints of its
// own, though, this worker left `?debug=1` showing whichever `'decoder'`
// checkpoint had been written last, and the crash spent three rounds
// looking like a decoder problem. Both of those are fixed now: vision
// loads the 4-bit-quantized export (measured 323.8MB peak, against
// 2,490.9MB for fp16 -- see `budget_calc::smart_parse_model`'s own doc
// comment) and reports ack-gated checkpoints through `ocrWorker.js` (see
// `checkpoint` below).
//
// Deliberately NOT memoized the way `ocrWorker.js`'s `loadGlmOcrModels`
// memoizes embed/decoder/tokenizer: every scan re-parses the vision ONNX
// graph and re-loads its weights into a brand-new wasm instance in a
// brand-new worker. The underlying bytes still come from Cache Storage
// (see glmOcrFetch.js), not a re-download, so this costs a few seconds of
// re-parsing per scan, not 290MB of network traffic -- an acceptable
// trade for guaranteeing memory release after every single scan, not
// just avoiding the crash on the first one.
import {
  GLM_OCR_MODEL_PATHS,
  fetchBytesCached,
  fetchDataFileIntoSession,
  throwIfLoadError,
  isMessageShaped,
} from './glmOcrFetch';

// Acks for `checkpoint` below. Vision is two workers away from the only
// thread that has `localStorage`, so each checkpoint relays through
// `ocrWorker.js`'s `runVisionInSubworker` and back -- this worker holds at
// its own `await` until that round trip confirms the write landed, so even
// an OS-level kill (which runs no JS afterwards, catchable by nothing)
// leaves a record of exactly which vision step was in flight.
let nextCheckpointId = 1;
const pendingCheckpointAcks = new Map();

function checkpoint(stage, exports) {
  let wasmMemoryBytes = null;
  try {
    wasmMemoryBytes = exports.memory.buffer.byteLength;
  } catch {
    // Not fatal -- the stage alone still says where this got to.
  }
  return new Promise((resolve) => {
    const checkpointId = nextCheckpointId++;
    pendingCheckpointAcks.set(checkpointId, resolve);
    self.postMessage({ checkpointId, checkpoint: { stage, wasmMemoryBytes } });
  });
}

self.onmessage = async (event) => {
  if (event.data?.checkpointAck != null) {
    pendingCheckpointAcks.get(event.data.checkpointAck)?.();
    pendingCheckpointAcks.delete(event.data.checkpointAck);
    return;
  }

  const { pixelValues, gridH, gridW } = event.data;
  try {
    const visionWasm = await import('../pkg-glmocr-vision');
    const exports = visionWasm.default ? await visionWasm.default() : undefined;

    const vision = new visionWasm.VisionEncoder();
    const track = (delta) => self.postMessage({ progress: { loadedBytes: delta } });
    await checkpoint('vision-graph', exports);
    const graph = await fetchBytesCached(GLM_OCR_MODEL_PATHS.visionGraph, track);
    await fetchDataFileIntoSession(vision, GLM_OCR_MODEL_PATHS.visionData, track, () =>
      checkpoint('vision-data', exports),
    );
    await checkpoint('vision-finish', exports);
    throwIfLoadError(vision.finish(graph));

    await checkpoint('vision-encode', exports);
    const imageFeatures = vision.encode(pixelValues, gridH, gridW);
    self.postMessage({ ok: true, imageFeatures }, [imageFeatures.buffer]);
  } catch (error) {
    // Same Message-shaped-vs-plain-error distinction `ocrWorker.js` makes
    // for its own generation loop -- `vision.encode`'s hot-path throw is
    // Message-shaped (a known calc failure); a network error or a
    // `vision.finish` load failure (via `throwIfLoadError`) is a plain
    // `Error`, an infra failure with no i18n code to show. Relayed as
    // whichever shape it already is so `runVisionInSubworker` in
    // `ocrWorker.js` can make that same distinction on the other end.
    self.postMessage({
      ok: false,
      error: isMessageShaped(error) ? error : (error?.message ?? String(error)),
    });
  }
};
