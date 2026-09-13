// Persists the last receipt-capture extraction failure to `localStorage`,
// so it survives whatever ends the tab next -- a crash, or even the
// hidden-tab reload this exact kind of failure can trigger (see
// `activityGuard.js`'s own doc comment). A plain `console.error` (what
// `ReceiptCapture.jsx`'s catch block used to rely on alone) is gone the
// instant the page navigates away, which is exactly why a real iPhone
// report of this same toast couldn't be diagnosed after the fact even
// with Safari's remote Web Inspector open on a retry -- there was
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
 * held before the failure -- `{ phase, page, totalPages }` or `null` -- so
 * a failure during a multi-page PDF read is distinguishable from one that
 * happened before any page-level progress was reported.
 */
export function recordReceiptFailure({ message, progress }) {
  writeRecord({
    outcome: 'failed',
    message,
    progress: progress ?? null,
    hiddenAtFailure: typeof document !== 'undefined' ? document.hidden : null,
  });
}

/** Overwrites a lingering `'failed'` record on a clean finish, so a later
 * look at `?debug=1` after a successful scan doesn't read as an
 * unresolved crash from earlier in the same tab's lifetime. */
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
