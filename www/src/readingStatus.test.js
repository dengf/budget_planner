import { describe, expect, it } from 'vitest';
import { readingStatus } from './readingStatus';

describe('readingStatus', () => {
  it('reports the page being read for a multi-page PDF', () => {
    expect(readingStatus({ phase: 'page', page: 2, totalPages: 5 })).toEqual({
      key: 'transactions.receiptReadingPage',
      params: { page: 2, totalPages: 5 },
    });
  });

  it('falls back to a generic reading message when there is no phase to report', () => {
    expect(readingStatus(null)).toEqual({ key: 'transactions.receiptReading' });
  });
});
