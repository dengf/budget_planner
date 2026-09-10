import { beforeEach, describe, expect, it } from 'vitest';
import { beginActivity, endActivity, isActivityInProgress } from './activityGuard';

describe('activityGuard', () => {
  beforeEach(() => {
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
});
