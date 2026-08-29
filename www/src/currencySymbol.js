// The currency symbol is a stored preference (localStorage), same
// host-layer reasoning as income.js and commitments.js: it's not a
// budget-calc concept, just a display choice the person picks for
// themselves. This app used to infer it from a US/SG "region" toggle
// (timezone, browser locale, a manual switch) -- that whole layer was
// removed as unneeded complexity; a plain symbol someone types once is
// simpler and covers more currencies than a two-option picker ever did.

const STORAGE_KEY = 'bp:currencySymbol';

export const DEFAULT_SYMBOL = '$';

export function loadCurrencySymbol() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && value.trim() ? value : DEFAULT_SYMBOL;
  } catch {
    return DEFAULT_SYMBOL;
  }
}

export function saveCurrencySymbol(symbol) {
  try {
    localStorage.setItem(STORAGE_KEY, symbol);
  } catch {
    // Preference just won't survive the tab; the session still switches.
  }
}
