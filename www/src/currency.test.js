import { describe, expect, it } from 'vitest';
import { currencySymbol, makeFormatMoney } from './currency';

describe('currency', () => {
  it('renders SGD with an explicit S$ so it cannot be read as USD', () => {
    // Intl's own `style: 'currency'` gives SGD a bare "$" under en-SG,
    // which is the whole reason the symbol is spelled out.
    expect(makeFormatMoney('SG')(1500)).toBe('S$1,500.00');
    expect(makeFormatMoney('US')(1500)).toBe('$1,500.00');
  });

  it('always shows two decimal places', () => {
    expect(makeFormatMoney('US')(1234567.8)).toBe('$1,234,567.80');
    expect(makeFormatMoney('US')(1000)).toBe('$1,000.00');
  });

  it('falls back to US for an unknown or missing region', () => {
    expect(makeFormatMoney(undefined)(10)).toBe('$10.00');
    expect(makeFormatMoney('XX')(10)).toBe('$10.00');
    expect(currencySymbol(undefined)).toBe('$');
  });

  it('returns a dash for a value that has not been computed yet', () => {
    expect(makeFormatMoney('US')(null)).toBe('—');
    expect(makeFormatMoney('SG')(undefined)).toBe('—');
  });

  it('exposes the bare symbol for field suffixes', () => {
    expect(currencySymbol('SG')).toBe('S$');
    expect(currencySymbol('US')).toBe('$');
  });
});
