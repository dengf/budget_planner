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

/**
 * `progress` is whatever `ReceiptCapture.jsx`'s own progress state last
 * held before the failure -- `{ phase, loadedBytes }` or `null` -- so a
 * failure that happened mid-download is distinguishable from one that
 * happened during parsing/generation, and how far the download had
 * gotten is visible without needing to have been watching live.
 */
export function recordReceiptFailure({ message, progress, smartParseEnabled }) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        message,
        progressPhase: progress?.phase ?? null,
        progressLoadedBytes: progress?.loadedBytes ?? null,
        smartParseEnabled,
        hiddenAtFailure: typeof document !== 'undefined' ? document.hidden : null,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch {
    // Private mode with storage disabled, or a quota error -- this is a
    // diagnostic nicety, not something the real failure handling depends on.
  }
}

/** Never clears the record -- overwritten by the next failure, otherwise
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
