// Runs voice-to-transaction ASR off the main thread.
//
// Same lazy-`import()`, worker-isolated pattern as `ocrWorker.js`, its own
// separate wasm module (`budget-wasm-voice`, wrapping `budget-calc`'s
// `voice` feature) for the same reason OCR/PDF/LLM are each their own:
// the QuartzNet15x5 model and `rten-embed`/`rten-tensor`/`rustfft` are
// weight only a session that actually opens the voice tab should pay for
// -- see budget-wasm-voice/src/lib.rs's own doc comment for the
// architecture rationale (CTC, not autoregressive; fp32, not int8 -- both
// measured, not assumed).
//
// Resolved against this worker's own runtime location (`self.location`),
// not a root-relative or page-relative path -- see `ocrWorker.js`'s own
// doc comment for the exact GitHub Pages subpath bug this avoids.
const VOICE_MODEL_PATH = new URL('voice/quartznet15x5-fp32.rten', self.location.href).href;

// The voice model is far larger than OCR's (tens of MB, fp32 -- see
// budget-wasm-voice's doc comment for why fp32 specifically), so unlike
// `ocrWorker.js`'s `modelBytesPromise` (memoized only for the lifetime of
// one worker instance), this also persists the bytes across page reloads
// via the Cache Storage API. Without it, reopening the voice tab in a new
// tab or after a refresh re-downloads the whole model from scratch every
// time -- a real, measured gap found during phone testing that plain
// worker-lifetime memoization doesn't address at all.
const MODEL_CACHE_NAME = 'budget-planner-voice-model-v1';

async function fetchModelBytes(url) {
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) return new Uint8Array(await cached.arrayBuffer());
  } catch {
    // Cache Storage unavailable (private browsing in some browsers) --
    // fall through to a plain fetch below. A slower repeat download beats
    // failing the feature entirely.
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
  // `res.clone()` before reading the body -- once `.arrayBuffer()` is
  // called below, the original response's body is consumed and can't be
  // handed to `cache.put` afterward.
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.put(url, res.clone());
  } catch {
    // Best-effort, see above -- the fetch itself still succeeds.
  }
  return new Uint8Array(await res.arrayBuffer());
}

let voiceWasmPromise = null;
let modelBytesPromise = null;

function loadVoiceWasm() {
  if (!voiceWasmPromise) {
    voiceWasmPromise = import('../pkg-voice').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return voiceWasmPromise;
}

// Same reset-on-rejection as `ocrWorker.js`'s `loadModels` -- a dropped
// connection during the very first (uncached) fetch shouldn't permanently
// poison every later attempt in this worker's lifetime.
function loadModel() {
  if (!modelBytesPromise) {
    modelBytesPromise = fetchModelBytes(VOICE_MODEL_PATH).catch((err) => {
      modelBytesPromise = null;
      throw err;
    });
  }
  return modelBytesPromise;
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    let result;
    if (type === 'transcribe') {
      const wasm = await loadVoiceWasm();
      const modelBytes = await loadModel();
      const { samples } = event.data;
      result = wasm.transcribe_voice_command(modelBytes, samples);
    } else {
      throw new Error(`voiceWorker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};
