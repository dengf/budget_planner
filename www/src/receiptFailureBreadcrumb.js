// Persists the last receipt-capture/Smart Parse extraction failure to
// `localStorage`, so it survives whatever ends the tab next -- a crash, an
// OS-level worker kill, or even the hidden-tab reload this exact kind of
// failure can trigger (see `activityGuard.js`'s own doc comment). A plain
// `console.error` (what `ReceiptCapture.jsx`'s catch block used to rely on
// alone) is gone the instant the page navigates away, which is exactly why
// a real iPhone report of this same toast couldn't be diagnosed after the
// fact even with Safari's remote Web Inspector open on a retry -- there was
// nothing left to inspect by the time anyone looked.
const KEY = 'bp:lastReceiptExtractionFailure';

function writeRecord(record) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...record, timestamp: new Date().toISOString() }));
  } catch {
    // Private mode with storage disabled, or a quota error -- this is a
    // diagnostic nicety, not something the real failure handling depends on.
  }
}

/**
 * `progress` is whatever `ReceiptCapture.jsx`'s own progress state last
 * held before the failure -- `{ phase, loadedBytes }` or `null` -- so a
 * failure that happened mid-download is distinguishable from one that
 * happened during parsing/generation, and how far the download had
 * gotten is visible without needing to have been watching live.
 *
 * `stage`/`wasmMemoryBytes` are only ever set for a Smart Parse model-load
 * failure -- which of GLM-OCR's models was loading (`'embed'`/`'decoder'`
 * for a chunk-download failure, `'embed-finish'`/`'decoder-finish'` for a
 * failure during that model's own `finish()` call -- see `ocrWorker.js`'s
 * `checkpointBeforeChunk` for why those are distinguished), and that
 * module's own wasm linear memory size at the moment it failed (see
 * `ocrWorker.js`'s `taggedModelLoadError`). `null` for every other
 * failure, including a Smart Parse failure that happens after loading
 * (generation) or a non-Smart-Parse OCR/PDF failure.
 */
export function recordReceiptFailure({
  message,
  progress,
  smartParseEnabled,
  stage,
  wasmMemoryBytes,
}) {
  writeRecord({
    outcome: 'failed',
    message,
    progressPhase: progress?.phase ?? null,
    progressLoadedBytes: progress?.loadedBytes ?? null,
    smartParseEnabled,
    stage: stage ?? null,
    wasmMemoryBytes: wasmMemoryBytes ?? null,
    hiddenAtFailure: typeof document !== 'undefined' ? document.hidden : null,
  });
}

/**
 * Written on the main thread right before a risky Smart Parse step (a wasm
 * chunk append) that could hard-crash the whole tab -- a real OS-level
 * memory kill, not a catchable exception (see `ocrWorker.js`'s and
 * `glmVisionWorker.js`'s own doc comments for two prior real-device
 * failures of exactly this kind). A kill like that runs no JS at all
 * afterward, so `recordReceiptFailure`'s catch-block-only recording misses
 * it entirely: nothing throws, so nothing ever reaches that `catch`, and
 * `?debug=1` would keep showing whatever the last *catchable* failure
 * happened to be, however old, with no way to tell it apart from a fresh
 * repro that got no further than this. `readLastReceiptFailure` returning
 * `outcome: 'checkpoint'` with a recent `timestamp` and no later
 * `'failed'`/`'succeeded'` record after it *is* the diagnostic: the app
 * never got a chance to report anything past that point.
 */
export function recordReceiptCheckpoint({ stage, wasmMemoryBytes, progress, smartParseEnabled }) {
  writeRecord({
    outcome: 'checkpoint',
    stage: stage ?? null,
    wasmMemoryBytes: wasmMemoryBytes ?? null,
    progressPhase: progress?.phase ?? null,
    progressLoadedBytes: progress?.loadedBytes ?? null,
    smartParseEnabled,
  });
}

/** Overwrites a lingering `'checkpoint'`/`'failed'` record on a clean
 * finish, so a later look at `?debug=1` after a successful scan doesn't
 * read as an unresolved crash from earlier in the same tab's lifetime. */
export function recordReceiptSuccess() {
  writeRecord({ outcome: 'succeeded' });
}

/** Never clears the record -- overwritten by the next event, otherwise
 * left in place so it's still inspectable via Local Storage directly even
 * if nothing was watching the console at boot. */
export function readLastReceiptFailure() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
