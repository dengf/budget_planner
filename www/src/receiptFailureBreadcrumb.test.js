import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordReceiptFailure, readLastReceiptFailure } from './receiptFailureBreadcrumb';

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

  it('round-trips a recorded failure, including download progress', () => {
    recordReceiptFailure({
      message: 'boom',
      progress: { phase: 'download', loadedBytes: 12345 },
      smartParseEnabled: true,
    });

    const record = readLastReceiptFailure();
    expect(record).toMatchObject({
      message: 'boom',
      progressPhase: 'download',
      progressLoadedBytes: 12345,
      smartParseEnabled: true,
    });
    expect(typeof record.timestamp).toBe('string');
  });

  it('records a null progress as null fields rather than crashing', () => {
    recordReceiptFailure({ message: 'boom', progress: null, smartParseEnabled: false });

    expect(readLastReceiptFailure()).toMatchObject({
      progressPhase: null,
      progressLoadedBytes: null,
    });
  });

  it('overwrites the previous record rather than accumulating', () => {
    recordReceiptFailure({ message: 'first', progress: null, smartParseEnabled: false });
    recordReceiptFailure({ message: 'second', progress: null, smartParseEnabled: false });

    expect(readLastReceiptFailure().message).toBe('second');
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() =>
      recordReceiptFailure({ message: 'boom', progress: null, smartParseEnabled: false }),
    ).not.toThrow();
    expect(readLastReceiptFailure()).toBeNull();
  });
});
