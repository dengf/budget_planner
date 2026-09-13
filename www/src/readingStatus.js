/**
 * Picks the i18n key and params for the one line shown while a receipt is
 * being read, from whatever `onProgress` last reported.
 *
 * Returns `{ key, params }`; `params` is `undefined` for keys that take
 * none.
 */
export function readingStatus(progress) {
  if (progress?.phase === 'page') {
    return {
      key: 'transactions.receiptReadingPage',
      params: { page: progress.page, totalPages: progress.totalPages },
    };
  }
  return { key: 'transactions.receiptReading' };
}
