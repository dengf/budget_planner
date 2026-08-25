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
 */
function reloadOnto(deployedId) {
  // If we already reloaded for this id and are somehow still stale,
  // something is wrong upstream — stop rather than loop.
  if (sessionStorage.getItem(RELOAD_GUARD_KEY) === deployedId) {
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
 */
export function startVersionCheck({ onStale } = {}) {
  const current = currentBuildId();
  if (!current) return () => {};

  tidyUrl();

  let stopped = false;

  const check = async ({ eager }) => {
    if (stopped) return;
    const deployed = await deployedBuildId();
    if (stopped || !deployed || deployed === current) return;

    if (eager || document.hidden) {
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
