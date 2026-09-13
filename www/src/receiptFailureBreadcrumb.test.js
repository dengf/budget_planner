import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordReceiptFailure,
  recordReceiptSuccess,
  readLastReceiptFailure,
} from './receiptFailureBreadcrumb';

// jsdom doesn't expose `localStorage` as a bare global in this test
// environment (see this repo's own CLAUDE.md note on the same gap
// affecting currencySymbol.js/commitments.js) -- stub a minimal in-memory
// Storage-alike so this module's actual read/write logic gets exercised
// instead of just falling into its catch-block fallback every time.
function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

describe('receiptFailureBreadcrumb', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when nothing has been recorded', () => {
    expect(readLastReceiptFailure()).toBeNull();
  });

  it('round-trips a recorded failure, including page-read progress', () => {
    recordReceiptFailure({
      message: 'boom',
      progress: { phase: 'page', page: 2, totalPages: 5 },
    });

    const record = readLastReceiptFailure();
    expect(record).toMatchObject({
      message: 'boom',
      progress: { phase: 'page', page: 2, totalPages: 5 },
    });
    expect(typeof record.timestamp).toBe('string');
  });

  it('records a null progress as null rather than crashing', () => {
    recordReceiptFailure({ message: 'boom', progress: null });

    expect(readLastReceiptFailure()).toMatchObject({ progress: null });
  });

  it('overwrites the previous record rather than accumulating', () => {
    recordReceiptFailure({ message: 'first', progress: null });
    recordReceiptFailure({ message: 'second', progress: null });

    expect(readLastReceiptFailure().message).toBe('second');
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => recordReceiptFailure({ message: 'boom', progress: null })).not.toThrow();
    expect(readLastReceiptFailure()).toBeNull();
  });

  it('tags a recorded failure with outcome "failed"', () => {
    recordReceiptFailure({ message: 'boom', progress: null });
    expect(readLastReceiptFailure()).toMatchObject({ outcome: 'failed' });
  });

  it('overwrites a lingering failure once the scan succeeds', () => {
    recordReceiptFailure({ message: 'boom', progress: null });
    recordReceiptSuccess();

    const record = readLastReceiptFailure();
    expect(record.outcome).toBe('succeeded');
    expect(typeof record.timestamp).toBe('string');
  });
});
