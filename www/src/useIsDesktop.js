import { useEffect, useState } from 'react';

const QUERY = '(min-width: 960px)';

/**
 * Reactive, unlike the one-shot `window.matchMedia?.(...).matches` reads
 * this codebase already uses for `prefers-reduced-motion`/`pointer:coarse`
 * (theme.js, SwipeHint.jsx, NewCategoryField.jsx, DashboardTab.jsx) --
 * those only need the value at the moment they run, but swapping the nav
 * shell has to track a window being resized live, not just read once at
 * mount. Same optional-chaining guard as those call sites: `matchMedia`
 * is unavailable in jsdom, so this returns `false` under test, which is
 * exactly the "stay on the phone shell" default every existing test
 * already assumes.
 */
export default function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia?.(QUERY);
    if (!mql) return undefined;
    const onChange = (e) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}
