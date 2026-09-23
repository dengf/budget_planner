import { useEffect, useState } from 'react';

/**
 * A CSS media query as a live boolean.
 *
 * Reactive, unlike the one-shot `window.matchMedia?.(...).matches` reads
 * this codebase also uses (theme.js, SwipeHint.jsx, NewCategoryField.jsx,
 * DashboardTab.jsx) -- those only need the value at the moment they run,
 * but anything that swaps markup has to track a window being resized
 * live, not just read once at mount.
 *
 * `fallback` is what to report when `matchMedia` is unavailable, which in
 * practice means jsdom: every caller here is choosing between a phone and
 * a desktop rendering, and each one picks the fallback that keeps the
 * test suite on the shell it already assumes.
 */
export default function useMediaQuery(query, fallback = false) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia
      ? fallback
      : window.matchMedia(query).matches,
  );

  // `query` is a module-level constant at every call site, so the
  // subscription is set up once and the initial read above is never
  // stale. Deliberately no re-read here on a `query` change: it would be
  // a setState in an effect body (eslint's `react-hooks/set-state-in-effect`)
  // bought for a case this app doesn't have.
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return undefined;
    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
