// Shared fetch/cache/retry helpers for Smart Parse's GLM-OCR model
// downloads -- used by both `ocrWorker.js` (embed, decoder, tokenizer)
// and `glmVisionWorker.js` (vision, in its own dedicated worker so its
// memory can be deterministically released the moment its one-time job
// is done -- see that file's own doc comment for why). Both workers need
// identical Cache Storage keys (so a chunk one of them fetches is reused
// by the other on a later scan) and identical retry behavior, so this
// lives in one place rather than being duplicated and risking drift.

// Smart Parse's model, unlike every other one `ocrWorker.js` fetches, is
// not vendored under `static/` -- GLM-OCR's fp16 ONNX export is ~2.2GB
// across these six files, far beyond what's reasonable to check into git
// or download on an ordinary visit (see `budget-calc::smart_parse_model`'s
// own doc comment). Fetched directly from Hugging Face's model CDN only
// the first time a user explicitly opts into Smart Parse, and cached
// afterwards via `caches.open()` below (Cache Storage, not just the
// browser's ordinary HTTP cache) so a second use, even in a later
// session, doesn't re-download 2.2GB.
export const GLM_OCR_BASE = 'https://huggingface.co/onnx-community/GLM-OCR-ONNX/resolve/main';
// Vision and the decoder both fetch GLM-OCR's 4-bit-quantized (`_q4`)
// exports rather than its fp16 ones -- see
// `budget_calc::smart_parse_model`'s own doc comment for why: `rten`
// upconverts fp16 weights to f32 at load time, roughly doubling each
// model's resident memory over its on-disk size, and these two are large
// enough that the doubling was killing real iOS Safari tabs outright.
// `MatMulNBits` (these exports' quantization scheme) reads its weights as
// native `u8` blocks instead, so each file's on-disk size (~290MB vision,
// ~373MB decoder) is close to its real resident footprint too.
//
// `embedData` has no matching `embedGraph` -- `TokenEmbedder` doesn't
// parse an ONNX graph at all (see `budget_calc::smart_parse_model`'s own
// doc comment), just this file's raw fp16 weight bytes directly. It stays
// on fp16 because its quantized export uses `GatherBlockQuantized`, an
// operator `rten` doesn't implement -- moot now that nothing upconverts
// it anyway.
export const GLM_OCR_MODEL_PATHS = {
  visionGraph: `${GLM_OCR_BASE}/onnx/vision_encoder_q4.onnx`,
  visionData: `${GLM_OCR_BASE}/onnx/vision_encoder_q4.onnx_data`,
  embedData: `${GLM_OCR_BASE}/onnx/embed_tokens_fp16.onnx_data`,
  decoderGraph: `${GLM_OCR_BASE}/onnx/decoder_model_merged_q4.onnx`,
  decoderData: `${GLM_OCR_BASE}/onnx/decoder_model_merged_q4.onnx_data`,
  tokenizer: `${GLM_OCR_BASE}/tokenizer.json`,
};

// v2, not v1: v1 cached each of the three large external-data files as
// one whole-file Cache Storage entry; v2 caches them in
// `GLM_OCR_CHUNK_BYTES`-sized pieces instead (see `fetchDataChunkCached`
// below), a different enough key shape that reusing the old name would
// just leave v1's whole-file entries as permanent dead weight never read
// again. The browser will evict `v1` under normal storage-pressure
// eviction like any other stale cache.
export const GLM_OCR_CACHE_NAME = 'smart-parse-glm-ocr-v2';

// Each of GLM-OCR's three external-data (weights) files is fetched in
// pieces this large via HTTP Range requests, rather than as one streamed
// response -- see `fetchDataFileIntoSession`'s own doc comment for why.
// Hugging Face's model CDN confirmed to honor `Range` with a real `206
// Partial Content` + `Content-Range` response before this was built on
// that assumption.
export const GLM_OCR_CHUNK_BYTES = 32 * 1024 * 1024;

// Smart Parse's ~2.2GB first-time download issues dozens of sequential
// network requests (a HEAD plus ~27 range requests per large file) over
// however many minutes that takes on a real connection -- long enough
// that a screen lock, backgrounding, or a wifi/cellular handoff dropping
// exactly one of them is an expected occurrence, not a rare edge case.
// Without this, that one dropped request failed the *entire* attempt --
// discarding every chunk already downloaded and cached in this same
// call -- with no automatic recovery, surfacing as the same generic,
// unhelpful "couldn't read that file" toast a real corrupt file would
// (see `ReceiptCapture.jsx`'s catch block). A few retries with a short
// growing delay covers a transient drop; a genuinely dead connection
// still fails after these, same as before.
const TRANSIENT_FETCH_RETRIES = 3;
const TRANSIENT_FETCH_RETRY_DELAY_MS = 1000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransientFetchRetry(attempt) {
  for (let tryNum = 0; ; tryNum++) {
    try {
      return await attempt();
    } catch (err) {
      if (tryNum >= TRANSIENT_FETCH_RETRIES) throw err;
      await wait(TRANSIENT_FETCH_RETRY_DELAY_MS * (tryNum + 1));
    }
  }
}

// Checks Cache Storage first (a prior Smart Parse download persists there
// across page loads, unlike an in-memory promise), and reports download
// progress via `onChunk(loadedDelta)` as bytes stream in -- the caller
// uses this to post incremental progress back to the main thread, since a
// fetch with no feedback reads as a frozen/broken app on a slow
// connection. Used for the three small graph files and the tokenizer;
// each of the three large external-data (weights) files instead goes
// through `fetchDataFileIntoSession` below.
//
// Writes straight into one pre-sized buffer (from the response's own
// `Content-Length` -- Hugging Face's CDN always sends one for these
// files) rather than an array of chunks concatenated at the end, and
// caches from that finished buffer rather than a `clone()`'d stream
// buffered concurrently by the Cache API. Falls back to the old
// chunks-then-concat approach only if a response is ever served without a
// usable `Content-Length`.
export async function fetchBytesCached(url, onChunk) {
  const cache = await caches.open(GLM_OCR_CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    const buf = await cached.arrayBuffer();
    onChunk(buf.byteLength);
    return new Uint8Array(buf);
  }

  // Retried as one unit rather than resuming mid-stream -- these are the
  // small graph/tokenizer files (single-digit MB), unlike the chunked
  // `fetchDataChunkCached` path below, so re-fetching from byte 0 on a
  // transient drop is cheap. A retry here does call `onChunk` again for
  // whatever a failed partial attempt already reported, inflating the
  // running progress total -- acceptable since that total is already
  // documented as approximate (see `SMART_PARSE_APPROX_TOTAL_BYTES` in
  // receiptCapture.js) and only ever clamped for display, never relied on
  // for correctness.
  const bytes = await withTransientFetchRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
    const reader = res.body.getReader();
    const declaredLength = Number(res.headers.get('content-length'));

    if (Number.isFinite(declaredLength) && declaredLength > 0) {
      const buf = new Uint8Array(declaredLength);
      let offset = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf.set(value, offset);
        offset += value.byteLength;
        onChunk(value.byteLength);
      }
      return buf;
    }

    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      onChunk(value.byteLength);
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return buf;
  });

  cache.put(url, new Response(bytes)).catch(() => {}); // best-effort; quota errors shouldn't fail the parse itself
  return bytes;
}

// Discovers a file's total byte length via a HEAD request, without
// downloading any of the body -- used only for the three large
// external-data files, to know how many `GLM_OCR_CHUNK_BYTES` range
// requests to issue and how large a buffer the session's own
// `begin_data` should reserve.
export async function fetchContentLength(url) {
  return withTransientFetchRetry(async () => {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new Error(`could not HEAD ${url}: ${res.status}`);
    const length = Number(res.headers.get('content-length'));
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error(`${url} did not report a usable Content-Length`);
    }
    return length;
  });
}

// Fetches one `GLM_OCR_CHUNK_BYTES`-sized (or smaller, for the last
// piece) range of `url`, checking Cache Storage first under a per-chunk
// key -- a prior interrupted download that already cached some chunks
// skips straight past them on retry, same resumability `fetchBytesCached`
// gets from whole-file caching, just at a finer grain (and, unlike
// whole-file caching, no partial progress is ever lost to an
// interruption beyond the one chunk in flight when it hit).
//
// The write to Cache Storage is awaited before this function returns,
// deliberately giving up the overlap a fire-and-forget `cache.put` would
// allow between one chunk's disk write and the next chunk's network
// fetch -- this runs ~27 times per large file in quick succession, and a
// disk write slower than the next chunk's fetch (plausible on iOS's
// encrypted storage) would otherwise let unfinished writes back up, each
// still holding its own chunk-sized buffer alive until it completed.
async function fetchDataChunkCached(url, start, end) {
  const cache = await caches.open(GLM_OCR_CACHE_NAME);
  const chunkKey = `${url}#bytes=${start}-${end}`;
  const cached = await cache.match(chunkKey);
  if (cached) return new Uint8Array(await cached.arrayBuffer());

  const bytes = await withTransientFetchRetry(async () => {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (res.status !== 206) {
      throw new Error(
        `expected a 206 Partial Content response to a ranged request for ${url}, got ${res.status}`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  });
  try {
    await cache.put(chunkKey, new Response(bytes));
  } catch {
    // best-effort; a quota or storage error shouldn't fail the parse itself
  }
  return bytes;
}

// Fetches one of GLM-OCR's three external-data (weights) files in
// `GLM_OCR_CHUNK_BYTES`-sized HTTP range requests, handing each chunk to
// `session.append_data_chunk` as soon as it arrives -- this worker never
// materializes the whole file as one JS buffer at all, not even
// one-file-at-a-time. A single such buffer crossing the JS/wasm boundary
// in one call was, on its own, enough to crash a real phone's tab
// (confirmed on a brand-new, high-RAM iPhone, in both Safari and Chrome,
// with only one tab open). Chunking bounds every single buffer this
// worker or `budget_calc::smart_parse_model` ever handles in one call to
// tens of MB, regardless of how large the overall model file is.
// `onBeforeChunk`, when given, fires right before every `append_data_chunk`
// call -- including the one that might trap -- so a caller wanting to know
// the module's wasm memory size right up to the moment of a crash (see
// `ocrWorker.js`'s `taggedModelLoadError`) can sample it there. A trap
// leaves that module's own `memory.buffer` unreadable afterwards, so
// sampling only after the fact (in a catch block) isn't reliable; sampling
// before each attempt is. Awaited (not just called) so a hook that also
// needs to durably persist that sample before the risky call -- see
// `ocrWorker.js`'s `checkpointBeforeChunk`, guarding against a harder
// failure than a catchable trap -- can hold this loop here until that's
// actually landed.
export async function fetchDataFileIntoSession(session, url, track, onBeforeChunk) {
  const totalLength = await fetchContentLength(url);
  session.begin_data(totalLength);
  for (let start = 0; start < totalLength; start += GLM_OCR_CHUNK_BYTES) {
    const end = Math.min(start + GLM_OCR_CHUNK_BYTES, totalLength) - 1;
    const chunk = await fetchDataChunkCached(url, start, end);
    await onBeforeChunk?.();
    session.append_data_chunk(chunk);
    track(chunk.byteLength);
  }
}

export function throwIfLoadError(loadResult) {
  if (loadResult?.error) throw new Error(loadResult.error);
}

// A `Message`-shaped value (`{ code, params, text }`) is what every
// hot-path Smart Parse call (`vision.encode`/`embed.embed`/
// `decoder.step`, and every `budget-wasm-glmocr-orchestrate` function)
// throws directly on a calc failure -- see
// budget-wasm-glmocr-vision/src/vision.rs's own doc comment for why those
// bypass the usual `{ error, error_message }` DTO convention that
// `vision.finish`/`embed.finish`/`decoder.finish` (checked via
// `throwIfLoadError` above) still use. Callers need to tell the two
// apart: a thrown `Message` is a known calc failure that should render
// through `CalcError` with a translated message, same as any other
// DTO-shaped result ever has; anything else (a network error, a wasm
// instantiation failure) is an infra failure with no i18n code to show.
export function isMessageShaped(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.code === 'string' &&
    typeof value.text === 'string'
  );
}
