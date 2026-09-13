// Tracks whether a long-running, hard-to-resume operation (right now:
// receipt/statement extraction) is in flight, so `version-check.js` can
// avoid reloading the page out from under it -- see that file's own doc
// comment.
//
// A counter, not a boolean: `ReceiptCapture.jsx` could in principle be
// re-entered (a second file picked while the first is still processing)
// before the first's `finally` runs, and a boolean would let the first
// call's cleanup clear the flag while the second is still genuinely busy.
let count = 0;

// Set when the counter drops back to zero while the tab is hidden. A real
// report showed the extraction dying (the worker got killed outright, not
// just left running) while backgrounded -- `endActivity()` still runs via
// `finally`, so `count` correctly reaches zero, but the visitor hasn't
// seen the resulting error toast (or a completed draft) yet. Without this,
// whether the automatic hidden-tab reload beats them back to the tab is a
// race against whatever next calls `startVersionCheck`'s check (the
// 5-minute timer, or a visibility flicker) -- sometimes it wins and the
// result is silently discarded, sometimes it doesn't and they see the
// toast. Staying "busy" until a `visibilitychange` confirms the tab is
// actually visible again makes that always the second outcome.
let pendingReveal = false;

export function beginActivity() {
  count += 1;
}

export function endActivity() {
  count = Math.max(0, count - 1);
  if (count === 0 && typeof document !== 'undefined' && document.hidden) {
    pendingReveal = true;
  }
}

export function isActivityInProgress() {
  return count > 0 || pendingReveal;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pendingReveal = false;
  });
}
