// One definition of how money is rendered, shared by every calculator.
//
// Previously each panel carried its own `formatMoney` hardcoded to en-US/USD.
// When the region toggle arrived only the Payment tab was updated, so a
// Singapore user saw S$ on one tab and $ on the other four — the app telling
// them their SGD loan was in US dollars.

// Symbols are spelled out rather than left to Intl's `style: 'currency'`:
// it renders SGD under en-SG as a bare "$", which is indistinguishable from
// USD in an app that switches between the two.
const CURRENCY = {
  US: { locale: 'en-US', symbol: '$' },
  SG: { locale: 'en-SG', symbol: 'S$' },
};

export const DEFAULT_REGION = 'US';

/**
 * Builds a money formatter for a region. Returns an em dash for null/
 * undefined so callers can hand it a value that hasn't been computed yet.
 */
export function makeFormatMoney(region) {
  const { locale, symbol } = CURRENCY[region] ?? CURRENCY[DEFAULT_REGION];
  return (n) =>
    n == null
      ? '—'
      : `${symbol}${n.toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
}

/** The bare unit symbol, for field suffixes rather than formatted values. */
export function currencySymbol(region) {
  return (CURRENCY[region] ?? CURRENCY[DEFAULT_REGION]).symbol;
}

/**
 * Formats an estimate, rounded to the nearest thousand and without cents.
 *
 * "Max home price S$458,187.04" implies a precision the model doesn't have —
 * it's derived from an assumed ratio, not a quote. Cents belong on payment
 * amounts, which are real.
 */
export function makeFormatEstimate(region) {
  const money = makeFormatMoney(region);
  return (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return money(value);
    return money(Math.round(n / 1000) * 1000).replace(/[.,]00$/, '');
  };
}
