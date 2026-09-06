// Whether the one-time "swipe to switch tabs" tip has already been shown.
// Same host-layer/localStorage reasoning as lastExported.js: a UI nicety
// with nothing downstream depending on it surviving a cleared cache -- if
// it's lost, the tip just shows once more.

const STORAGE_KEY = 'bp:seenSwipeHint';

export function loadSeenSwipeHint() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSeenSwipeHint() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Tip just reappears next session; harmless.
  }
}
