import useMediaQuery from './useMediaQuery';

const QUERY = '(min-width: 960px)';

/**
 * True once the window is wide enough for the desktop shell (sidebar nav,
 * multi-column panels). The plumbing lives in `useMediaQuery`; this is
 * the one place that names the breakpoint, so the dozen callers that swap
 * a phone layout for a desktop one can never drift apart on the number.
 *
 * `matchMedia` is unavailable in jsdom, so this returns `false` under
 * test, which is exactly the "stay on the phone shell" default every
 * existing test already assumes.
 */
export default function useIsDesktop() {
  return useMediaQuery(QUERY, false);
}
