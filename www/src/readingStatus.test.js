import { describe, expect, it } from 'vitest';
import { readingStatus } from './readingStatus';
import { SMART_PARSE_APPROX_TOTAL_BYTES } from './receiptCapture';

// The byte count vision's download leaves frozen while the encoder runs:
// vision graph + data, the real figure from a device breadcrumb.
const AFTER_VISION_DOWNLOAD = 304_972_537;

describe('readingStatus', () => {
  it('reports downloading while bytes are still arriving', () => {
    const { key, params } = readingStatus(
      { phase: 'download', loadedBytes: AFTER_VISION_DOWNLOAD },
      true,
    );
    expect(key).toBe('transactions.smartParseDownloading');
    expect(params.percent).toBe(35);
    expect(params.loadedBytes).toBe(AFTER_VISION_DOWNLOAD);
    expect(params.totalBytes).toBe(SMART_PARSE_APPROX_TOTAL_BYTES);
  });

  // The regression this module exists for: the encoder runs for minutes
  // with `loadedBytes` stuck at exactly the figure above, and the old
  // logic kept rendering "Downloading… 35%" the whole time.
  it('stops claiming a download once the vision encoder takes over', () => {
    expect(readingStatus({ phase: 'encode', loadedBytes: AFTER_VISION_DOWNLOAD }, true)).toEqual({
      key: 'transactions.smartParseEncoding',
    });
  });

  it('counts tokens while generating, rather than showing a stale byte total', () => {
    expect(
      readingStatus({ phase: 'generate', loadedBytes: AFTER_VISION_DOWNLOAD, tokens: 42 }, true),
    ).toEqual({ key: 'transactions.smartParseGenerating', params: { tokens: 42 } });
  });

  it('treats a generate phase with no count yet as zero, not missing', () => {
    const { params } = readingStatus({ phase: 'generate' }, true);
    expect(params).toEqual({ tokens: 0 });
  });

  it('falls back to the download message once every byte has arrived', () => {
    const { key } = readingStatus(
      { phase: 'download', loadedBytes: SMART_PARSE_APPROX_TOTAL_BYTES },
      true,
    );
    expect(key).toBe('transactions.smartParseRunning');
  });

  it('reports the page being read for a multi-page PDF', () => {
    expect(readingStatus({ phase: 'page', page: 2, totalPages: 5 }, false)).toEqual({
      key: 'transactions.receiptReadingPage',
      params: { page: 2, totalPages: 5 },
    });
  });

  it('distinguishes the two engines when there is no phase to report', () => {
    expect(readingStatus(null, true)).toEqual({ key: 'transactions.smartParseRunning' });
    expect(readingStatus(null, false)).toEqual({ key: 'transactions.receiptReading' });
  });
});
