import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordReceiptFailure,
  recordReceiptCheckpoint,
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

  it('records which model was loading and its wasm memory size, when known', () => {
    recordReceiptFailure({
      message: 'Unreachable code should not be executed',
      progress: { phase: 'download', loadedBytes: 201650415 },
      smartParseEnabled: true,
      stage: 'decoder',
      wasmMemoryBytes: 2214592512,
    });

    expect(readLastReceiptFailure()).toMatchObject({
      stage: 'decoder',
      wasmMemoryBytes: 2214592512,
    });
  });

  it('records stage and wasmMemoryBytes as null when not a model-load failure', () => {
    recordReceiptFailure({ message: 'boom', progress: null, smartParseEnabled: false });

    expect(readLastReceiptFailure()).toMatchObject({
      stage: null,
      wasmMemoryBytes: null,
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

  it('tags a recorded failure with outcome "failed"', () => {
    recordReceiptFailure({ message: 'boom', progress: null, smartParseEnabled: false });
    expect(readLastReceiptFailure()).toMatchObject({ outcome: 'failed' });
  });

  it('records a checkpoint distinctly from a failure, including which model and its memory size', () => {
    recordReceiptCheckpoint({
      stage: 'decoder',
      wasmMemoryBytes: 391168000,
      progress: { phase: 'download', loadedBytes: 201650415 },
      smartParseEnabled: true,
    });

    expect(readLastReceiptFailure()).toMatchObject({
      outcome: 'checkpoint',
      stage: 'decoder',
      wasmMemoryBytes: 391168000,
      progressPhase: 'download',
      progressLoadedBytes: 201650415,
      smartParseEnabled: true,
    });
  });

  it('overwrites a lingering checkpoint/failure once the scan succeeds', () => {
    recordReceiptCheckpoint({
      stage: 'decoder',
      wasmMemoryBytes: 1000,
      progress: null,
      smartParseEnabled: true,
    });
    recordReceiptSuccess();

    const record = readLastReceiptFailure();
    expect(record.outcome).toBe('succeeded');
    expect(typeof record.timestamp).toBe('string');
  });
});
