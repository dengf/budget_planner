import { SMART_PARSE_APPROX_TOTAL_BYTES } from './receiptCapture';

/**
 * Picks the i18n key and params for the one line shown while a receipt is
 * being read, from whatever `onProgress` last reported.
 *
 * This lives apart from `ReceiptCapture.jsx` because getting it wrong is
 * not a cosmetic problem. A Smart Parse scan spends most of its wall clock
 * in two phases -- the vision encoder, then the generation loop -- during
 * which `loadedBytes` is frozen at whatever the last download left it.
 * The first version of this logic had only a `'download'` phase and fell
 * through to it, so a working scan showed "Downloading… 35%" unchanged for
 * four minutes and got reported as a hang. CLAUDE.md's "never state
 * something that isn't true yet" applies to progress text as much as to a
 * total: a byte count that has stopped moving must not be presented as a
 * download still in flight.
 *
 * Returns `{ key, params }`; `params` is `undefined` for keys that take
 * none. Ordering matters -- the compute phases are checked before any
 * byte-count fallback, never after.
 */
export function readingStatus(progress, smartParseEnabled) {
  if (progress?.phase === 'encode') {
    return { key: 'transactions.smartParseEncoding' };
  }
  if (progress?.phase === 'generate') {
    return {
      key: 'transactions.smartParseGenerating',
      params: { tokens: progress.tokens ?? 0 },
    };
  }
  if (progress?.phase === 'download' && progress.loadedBytes < SMART_PARSE_APPROX_TOTAL_BYTES) {
    return {
      key: 'transactions.smartParseDownloading',
      params: {
        percent: Math.min(
          100,
          Math.round((progress.loadedBytes / SMART_PARSE_APPROX_TOTAL_BYTES) * 100),
        ),
        loadedBytes: progress.loadedBytes,
        totalBytes: SMART_PARSE_APPROX_TOTAL_BYTES,
      },
    };
  }
  if (progress?.phase === 'page') {
    return {
      key: 'transactions.receiptReadingPage',
      params: { page: progress.page, totalPages: progress.totalPages },
    };
  }
  return {
    key: smartParseEnabled ? 'transactions.smartParseRunning' : 'transactions.receiptReading',
  };
}
