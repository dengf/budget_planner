// Runs voice-to-transaction ASR off the main thread.
//
// Same lazy-`import()`, worker-isolated pattern as `ocrWorker.js`, and now
// its own multi-model dispatcher following that file's template: one
// worker file, one `self.onmessage`, a per-language wasm module and model
// path, each loaded only the first time that language's own message type
// actually arrives. English (`budget-wasm-voice`, WeNet LibriSpeech
// U2++ Conformer, ~69.4MB) and Mandarin (`budget-wasm-voice-cmn`, WeNet
// AISHELL-1 U2++ Conformer, ~68.9MB) are
// mutually exclusive per user action -- a session that only ever speaks
// one language never downloads the other one's model or wasm module --
// see budget-wasm-voice-cmn/src/lib.rs's own doc comment for the
// architecture rationale (CTC, not autoregressive; fp32, not int8 -- both
// measured, not assumed).
//
// Resolved against this worker's own runtime location (`self.location`),
// not a root-relative or page-relative path -- see `ocrWorker.js`'s own
// doc comment for the exact GitHub Pages subpath bug this avoids.
const VOICE_MODEL_PATHS = {
  en: new URL('voice/en-wenet-f16.onnx', self.location.href).href,
  cmn: new URL('voice/zh-wenet-f16.onnx', self.location.href).href,
};

// Voice models are far larger than OCR's (tens of MB even as f16 -- see
// budget-wasm-voice/budget-wasm-voice-cmn's doc comments for why the
// weights are f16 but the arithmetic is not), so unlike `ocrWorker.js`'s
// `modelBytesPromise`
// (memoized only for the lifetime of one worker instance), this also
// persists the bytes across page reloads via the Cache Storage API.
// Without it, reopening the voice tab in a new tab or after a refresh
// re-downloads the whole model from scratch every time -- a real, measured
// gap found during phone testing that plain worker-lifetime memoization
// doesn't address at all.
//
// Bumped to v2 (was v1, English-only) when this cache started holding
// more than one language's model keyed by URL; old entries simply go
// unused rather than needing an explicit migration. The English and
// Mandarin model swap did not need another bump for the same reason --
// the keys are the model URLs, and both filenames changed. Nor did the
// f16 swap, which changed both filenames again.
const MODEL_CACHE_NAME = 'budget-planner-voice-model-v2';

// Each language's real model is comfortably larger than this; a git-lfs
// pointer text file (what a misconfigured deploy can serve at the same URL
// with a perfectly valid 200 OK -- this bit us for real, see
// deploy-web.yml's `lfs: true` fix) is ~130 bytes. Cache Storage has no
// concept of "this response is wrong," so without this check a pointer
// file fetched during a broken deploy gets cached as if it were the model
// and served back indefinitely, long after the server is fixed -- nothing
// else would ever invalidate it. This threshold is what actually catches
// that, for bytes already sitting in the cache and for anything freshly
// fetched before it's allowed to be cached. Every floor stays well below
// its own model's real size -- English ~69.4MB, Mandarin ~68.9MB -- so
// the check only ever rejects something that is not a model at all.
const MIN_VALID_MODEL_BYTES = {
  en: 50 * 1024 * 1024,
  cmn: 50 * 1024 * 1024,
};

async function fetchModelBytes(url, minValidBytes) {
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    const cached = await cache.match(url);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (bytes.length >= minValidBytes) return bytes;
      // Stale/corrupt entry from a past broken deploy -- drop it and fall
      // through to a real fetch instead of serving it forever.
      await cache.delete(url);
    }
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
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  if (bytes.length < minValidBytes) {
    throw new Error(`model at ${url} looks truncated (${bytes.length} bytes)`);
  }
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.put(url, res.clone());
  } catch {
    // Best-effort, see above -- the fetch itself still succeeds.
  }
  return bytes;
}

const voiceWasmPromises = {};
const modelBytesPromises = {};

// Two separate literal `import()` calls, not one call with a variable
// path -- webpack needs a static string to know which lazy chunk to
// bundle and split, the same reason `ocrWorker.js` never computes its
// `import()` targets either.
function loadEnWasm() {
  if (!voiceWasmPromises.en) {
    voiceWasmPromises.en = import('../pkg-voice').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return voiceWasmPromises.en;
}

function loadCmnWasm() {
  if (!voiceWasmPromises.cmn) {
    voiceWasmPromises.cmn = import('../pkg-voice-cmn').then(async (wasm) => {
      if (wasm.default) await wasm.default();
      return wasm;
    });
  }
  return voiceWasmPromises.cmn;
}

function loadVoiceWasm(language) {
  if (language === 'cmn') return loadCmnWasm();
  return loadEnWasm();
}

// Same reset-on-rejection as `ocrWorker.js`'s `loadModels` -- a dropped
// connection during the very first (uncached) fetch shouldn't permanently
// poison every later attempt in this worker's lifetime.
function loadModel(language) {
  if (!modelBytesPromises[language]) {
    modelBytesPromises[language] = fetchModelBytes(
      VOICE_MODEL_PATHS[language],
      MIN_VALID_MODEL_BYTES[language],
    ).catch((err) => {
      modelBytesPromises[language] = null;
      throw err;
    });
  }
  return modelBytesPromises[language];
}

self.onmessage = async (event) => {
  const { id, type } = event.data;
  try {
    let result;
    if (type === 'transcribe-en' || type === 'transcribe-cmn') {
      const language = type.slice('transcribe-'.length);
      const wasm = await loadVoiceWasm(language);
      const modelBytes = await loadModel(language);
      const { samples } = event.data;
      if (language === 'cmn') {
        result = wasm.transcribe_voice_command_cmn(modelBytes, samples);
      } else {
        result = wasm.transcribe_voice_command(modelBytes, samples);
      }
    } else {
      throw new Error(`voiceWorker: unknown message type "${type}"`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
  }
};
