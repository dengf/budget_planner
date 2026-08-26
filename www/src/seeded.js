// Whether this browser has already been offered the starter categories.
//
// A first-run budget seeds itself with `budget-calc::presets`, so nobody
// meets an empty page. That has to happen exactly once: someone who
// deliberately deletes every category, or uses "clear all data", must not
// find the presets resurrected on the next load. An empty category list
// alone can't tell those two states apart, so the fact that seeding has
// happened is recorded here -- a stored preference, same host-layer
// pattern as region.js and income.js.

const STORAGE_KEY = 'bp:seeded';

export function hasSeeded() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode with no storage: report "already seeded" so the app
    // errs toward leaving the person's data alone rather than re-adding
    // categories on every single load.
    return true;
  }
}

export function rememberSeeded() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Nothing persists this session; the in-memory guard in App.jsx still
    // stops a second pass before the next reload.
  }
}
