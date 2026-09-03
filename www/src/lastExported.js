// When the last backup was written, so "My data" can show how stale it
// is. Same host-layer reasoning as currencySymbol.js: this is a UI nicety
// about the export, not a budget-calc concept, and losing it just means
// the reminder starts over -- nothing downstream depends on it surviving.

const STORAGE_KEY = 'bp:lastExportedAt';

export function loadLastExported() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLastExported(iso) {
  try {
    localStorage.setItem(STORAGE_KEY, iso);
  } catch {
    // Reminder just won't survive the tab; the export itself still happened.
  }
}
