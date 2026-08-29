// One definition of how money is rendered, used by every tab.
//
// Previously each panel carried its own `formatMoney` hardcoded to en-US/USD.
// This used to pick a locale/symbol pair off a US/SG region toggle; that
// toggle was removed as unneeded complexity in favor of a single symbol the
// person sets for themselves (see currencySymbol.js) — digit grouping
// (1,000 vs 1.000) doesn't actually vary between the two currencies this
// app ever supported, so a fixed 'en-US' number format plus a free-form
// symbol loses nothing.

import { DEFAULT_SYMBOL } from './currencySymbol';

/**
 * Builds a money formatter for a given currency symbol. Returns an em dash
 * for null/undefined so callers can hand it a value that hasn't been
 * computed yet.
 */
export function makeFormatMoney(symbol) {
  const sym = symbol || DEFAULT_SYMBOL;
  return (n) =>
    n == null
      ? '—'
      : `${sym}${n.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
}
