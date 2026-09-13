// Picks up a new deployment without the visitor having to hard-refresh.
//
// GitHub Pages serves HTML with `cache-control: max-age=600` and offers no
// way to change that — there is no `_headers` file or equivalent. So for up
// to ten minutes after a deploy, a returning visitor can still be running
// the previous HTML (and therefore the previous bundle) with nothing to
// indicate it is stale. That is not theoretical: it is exactly what made a
// currency fix look like it had not deployed when it had.
//
// The bundle is stamped with its build id at compile time; `version.json`
// carries the id of whatever is currently deployed. If they differ, this
// page is stale.

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const CACHE_BUST_PARAM = 'v';
const RELOAD_GUARD_KEY = 'bp:reloaded-for-build';

/** The id compiled into this bundle, or null outside a webpack build. */
function currentBuildId() {
  return typeof __BUILD_ID__ === 'undefined' ? null : __BUILD_ID__;
}

async function deployedBuildId() {
  try {
    // `no-store` matters: fetching this through the same HTTP cache that
    // served the stale HTML would just confirm the stale answer.
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const { buildId } = await res.json();
    return typeof buildId === 'string' ? buildId : null;
  } catch {
    // Offline, or the file isn't deployed yet. Staying on the current
    // version is the right failure mode.
    return null;
  }
}

/**
 * Reloads onto the deployed build.
 *
 * A plain `location.reload()` is allowed to re-serve the same cached HTML,
 * which would leave the page exactly as stale as before, so navigate to a
 * URL the cache has never seen instead. `replace` rather than `assign` so
 * the stale page doesn't become a back-button destination.
 *
 * `force` skips the reload-loop guard below. It exists for exactly one
 * caller: `UpdateBanner`'s own Reload button. Without it, a visitor who
 * arrived while GitHub Pages' ten-minute HTML cache was still serving an
 * older deploy than the one `version.json` already reports would silently
 * do nothing on a second click — the automatic reload that ran first (on
 * load, or while the tab was hidden) already set the guard for that same
 * id, so every later match against it, automatic or not, used to bail out
 * with only a `console.warn` no one watching the tab could see. A person
 * clicking a visible button deliberately is not the runaway-loop case this
 * guard exists to stop; only the automatic path needs protecting from
 * that.
 */
export function reloadOnto(deployedId, { force = false } = {}) {
  // If we already reloaded for this id and are somehow still stale,
  // something is wrong upstream — stop rather than loop. Does not apply
  // to a forced (manual button) reload — see doc comment above.
  if (!force && sessionStorage.getItem(RELOAD_GUARD_KEY) === deployedId) {
    console.warn(`Still running an old build after reloading for ${deployedId}; not retrying.`);
    return;
  }
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, deployedId);
  } catch {
    // Private mode with storage disabled: the guard is a nicety, and
    // skipping it is better than not reloading at all.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(CACHE_BUST_PARAM, deployedId);
  window.location.replace(url.toString());
}

/** Drops the cache-busting param so it doesn't linger in shared URLs. */
function tidyUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(CACHE_BUST_PARAM)) return;
  url.searchParams.delete(CACHE_BUST_PARAM);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/**
 * Starts watching for new deployments.
 *
 * On arrival a stale page reloads straight away — nothing is typed yet, so
 * there is nothing to lose. Once the page is in use it only reloads while
 * the tab is hidden, since replacing the page under someone mid-calculation
 * would discard whatever they had entered. Saved scenarios live in
 * IndexedDB and survive either way; unsaved field values do not.
 *
 * `isBusy` is the one exception to "hidden means safe to reload": a real
 * report from an in-flight receipt extraction (no saved state until it
 * finishes) showed the page reloading mid-extraction with no error at
 * all — indistinguishable from a crash, but actually this same "safe"
 * hidden-tab reload firing while the tab had simply been backgrounded for
 * a moment. `isBusy()` (backed by `activityGuard.js`) is checked alongside
 * `document.hidden` so this path defers to `onStale` instead — the banner
 * it renders is inert while the tab stays hidden, costing nothing, and the
 * next check (the 5-minute timer, or the next visibility change) reloads
 * normally once the extraction has finished.
 */
export function startVersionCheck({ onStale, isBusy } = {}) {
  const current = currentBuildId();
  if (!current) return () => {};

  tidyUrl();

  let stopped = false;

  const check = async ({ eager }) => {
    if (stopped) return;
    const deployed = await deployedBuildId();
    if (stopped || !deployed || deployed === current) return;

    if ((eager || document.hidden) && !(isBusy && isBusy())) {
      reloadOnto(deployed);
    } else if (onStale) {
      onStale(deployed);
    }
  };

  // Eager on first run: this is page load, so a reload costs the visitor
  // nothing and fixes the stale-HTML case immediately.
  check({ eager: true });

  const onVisibility = () => check({ eager: false });
  const timer = setInterval(() => check({ eager: false }), POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
