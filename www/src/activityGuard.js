// Tracks whether a long-running, hard-to-resume operation (right now:
// receipt/statement extraction, including Smart Parse's multi-minute
// model download) is in flight, so `version-check.js` can avoid reloading
// the page out from under it -- see that file's own doc comment.
//
// A counter, not a boolean: `ReceiptCapture.jsx` could in principle be
// re-entered (a second file picked while the first is still processing)
// before the first's `finally` runs, and a boolean would let the first
// call's cleanup clear the flag while the second is still genuinely busy.
let count = 0;

export function beginActivity() {
  count += 1;
}

export function endActivity() {
  count = Math.max(0, count - 1);
}

export function isActivityInProgress() {
  return count > 0;
}
