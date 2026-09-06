// The color theme is a stored preference (localStorage), same host-layer
// reasoning as currencySymbol.js: it's not a budget-calc concept, just a
// display choice the person picks for themselves. 'system' (the default)
// means "no opinion, follow the OS" -- the app already did this via a
// plain `prefers-color-scheme` media query before this file existed, and
// stays that way unless someone picks 'light' or 'dark' explicitly.

const STORAGE_KEY = 'bp:theme';
export const THEMES = ['system', 'light', 'dark'];
export const DEFAULT_THEME = 'system';

export function loadTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Preference just won't survive the tab; the session still switches.
  }
}

/**
 * Stamps (or clears) `data-theme` on the root element, which is what
 * main.css's `:root[data-theme='light']`/`[data-theme='dark']` rules key
 * off to override the `prefers-color-scheme` default in either direction.
 * `index.html` calls this same way, synchronously, before React or even
 * main.css's link tag resolves -- see its inline script's comment for why
 * that copy has to exist separately rather than only running from here.
 */
export function applyTheme(theme) {
  const root = document?.documentElement;
  if (!root) return;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }

  // Mobile browser chrome (the address bar strip) reads this on every
  // change, not just at page load -- index.html's inline script sets the
  // same content on first paint, before this module ever loads, for the
  // reason explained in its own comment; this is what keeps it in sync
  // after that, whenever the picker in YourDataMenu changes theme.
  const isLight =
    theme === 'light' ||
    (theme !== 'dark' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  document
    .getElementById('theme-color-meta')
    ?.setAttribute('content', isLight ? '#f7f8fa' : '#0f1720');
}
