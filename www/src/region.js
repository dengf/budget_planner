// Browser-side signal gathering for which market's category presets and
// currency label to open with.
//
// Unlike mortgage_calculator's region, this carries no regulatory ruleset
// -- there is no budgeting-equivalent of MAS TDSR whose ranking logic
// belongs in Rust. It only picks a currency label and a starter category
// list, so the detection stays in JS rather than crossing the wasm
// boundary for a decision with no business content to test.

const STORAGE_KEY = 'bp:region';
const REGION_PARAM = 'region';

export const DEFAULT_REGION = 'US';
const KNOWN_REGIONS = ['US', 'SG'];

function fromUrl() {
  try {
    const value = new URLSearchParams(window.location.search).get(REGION_PARAM);
    return KNOWN_REGIONS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function fromStorage() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return KNOWN_REGIONS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function fromTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    return tz === 'Asia/Singapore' ? 'SG' : null;
  } catch {
    return null;
  }
}

function fromLocale() {
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    return (tags ?? []).some((t) => /-sg$/i.test(t)) ? 'SG' : null;
  } catch {
    return null;
  }
}

/** A link or a remembered choice both beat an inferred signal, since both
 *  are explicit; time zone is a stronger inference than locale alone. */
export function detectRegion() {
  return fromUrl() ?? fromStorage() ?? fromTimeZone() ?? fromLocale() ?? DEFAULT_REGION;
}

export function rememberRegion(region) {
  try {
    localStorage.setItem(STORAGE_KEY, region);
  } catch {
    // Preference just won't survive the tab; the session still switches.
  }
}
