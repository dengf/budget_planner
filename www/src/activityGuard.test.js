import { beforeEach, describe, expect, it } from 'vitest';
import { beginActivity, endActivity, isActivityInProgress } from './activityGuard';

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

describe('activityGuard', () => {
  beforeEach(() => {
    // Force visible first: draining via `endActivity()` alone can't clear
    // a `pendingReveal` left set by a previous test, since that only
    // clears on a visibilitychange to visible -- looping `endActivity()`
    // while still hidden would spin forever.
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    // Drain any count left over from a previous test -- there is no reset
    // export, since production code never needs one.
    while (isActivityInProgress()) endActivity();
  });

  it('is not in progress until something begins', () => {
    expect(isActivityInProgress()).toBe(false);
  });

  it('reports in progress between begin and end', () => {
    beginActivity();
    expect(isActivityInProgress()).toBe(true);
    endActivity();
    expect(isActivityInProgress()).toBe(false);
  });

  it('stays in progress until every overlapping begin has a matching end', () => {
    beginActivity();
    beginActivity();
    endActivity();
    expect(isActivityInProgress()).toBe(true);
    endActivity();
    expect(isActivityInProgress()).toBe(false);
  });

  it('does not go negative on an unmatched end', () => {
    endActivity();
    endActivity();
    expect(isActivityInProgress()).toBe(false);
    beginActivity();
    expect(isActivityInProgress()).toBe(true);
  });

  it('stays in progress after ending while hidden, until the tab is revisited', () => {
    // The real-device regression this covers: a Smart Parse extraction
    // crashing (or finishing) while the tab is backgrounded shouldn't hand
    // version-check's hidden-tab reload a green light before the visitor
    // has had a chance to see the result.
    setHidden(true);
    beginActivity();
    endActivity();
    expect(isActivityInProgress()).toBe(true);

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(isActivityInProgress()).toBe(false);
  });

  it('does not stay in progress after ending while already visible', () => {
    setHidden(false);
    beginActivity();
    endActivity();
    expect(isActivityInProgress()).toBe(false);
  });

  it('ignores a visibility change to hidden -- only a return to visible clears it', () => {
    setHidden(true);
    beginActivity();
    endActivity();
    expect(isActivityInProgress()).toBe(true);

    document.dispatchEvent(new Event('visibilitychange')); // still hidden
    expect(isActivityInProgress()).toBe(true);
  });
});
