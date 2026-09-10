import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadOnto, startVersionCheck } from './version-check';

function mockDeployedBuildId(buildId) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buildId }),
    }),
  );
}

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

// jsdom's `window.location.replace` isn't configurable, so `vi.spyOn` can't
// wrap it directly -- replace the whole `location` object instead, keeping
// its real `href` (which `reloadOnto` reads via `new URL(...)`).
const originalLocation = window.location;

function stubLocationReplace() {
  const replaceSpy = vi.fn();
  const { href } = originalLocation;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href, replace: replaceSpy },
  });
  return replaceSpy;
}

function restoreLocation() {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
}

describe('reloadOnto', () => {
  let replaceSpy;

  beforeEach(() => {
    sessionStorage.clear();
    replaceSpy = stubLocationReplace();
  });

  afterEach(() => {
    restoreLocation();
  });

  it('reloads the first time it is called for a given build', () => {
    reloadOnto('build-a');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reload again for the same build once already reloaded for it', () => {
    reloadOnto('build-a');
    reloadOnto('build-a');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads a second time for the same build when forced', () => {
    // This is what UpdateBanner's Reload button relies on: without
    // `force`, a click landing on a still-stale reload (GitHub Pages'
    // ten-minute HTML cache) would silently do nothing a second time.
    reloadOnto('build-a');
    reloadOnto('build-a', { force: true });
    expect(replaceSpy).toHaveBeenCalledTimes(2);
  });
});

describe('startVersionCheck', () => {
  let replaceSpy;
  let stop;

  // The very first check `startVersionCheck` runs is always `eager`, which
  // reloads regardless of visibility (see the file's own doc comment: on
  // arrival, nothing typed yet, nothing to lose). So to exercise the
  // hidden-vs-visible distinction these tests care about, each one first
  // lets that initial eager check see no update at all, then flips the
  // mocked deploy id and fires the same `visibilitychange`-driven,
  // non-eager check the app relies on for an already-open tab.
  async function triggerNonEagerCheck(deployedId) {
    mockDeployedBuildId(deployedId);
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    sessionStorage.clear();
    replaceSpy = stubLocationReplace();
    vi.stubGlobal('__BUILD_ID__', 'current-build');
    mockDeployedBuildId('current-build');
  });

  afterEach(() => {
    stop?.();
    restoreLocation();
    vi.unstubAllGlobals();
    setHidden(false);
  });

  it('reloads a hidden tab onto a newly deployed build when nothing is busy', async () => {
    setHidden(true);
    const onStale = vi.fn();
    stop = startVersionCheck({ onStale, isBusy: () => false });

    await triggerNonEagerCheck('new-build');

    await vi.waitFor(() => expect(replaceSpy).toHaveBeenCalledTimes(1));
    expect(onStale).not.toHaveBeenCalled();
  });

  it('defers to onStale instead of reloading a hidden tab while busy', async () => {
    // The real-device regression this covers: a Smart Parse download in
    // flight, tab briefly backgrounded, page silently reloaded and lost
    // the whole download with no error at all.
    setHidden(true);
    const onStale = vi.fn();
    stop = startVersionCheck({ onStale, isBusy: () => true });

    await triggerNonEagerCheck('new-build');

    await vi.waitFor(() => expect(onStale).toHaveBeenCalledWith('new-build'));
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('defers to onStale for a visible tab regardless of busy state', async () => {
    setHidden(false);
    const onStale = vi.fn();
    stop = startVersionCheck({ onStale, isBusy: () => false });

    await triggerNonEagerCheck('new-build');

    await vi.waitFor(() => expect(onStale).toHaveBeenCalledWith('new-build'));
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
