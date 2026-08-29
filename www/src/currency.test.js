import { describe, expect, it } from 'vitest';
import { makeFormatMoney } from './currency';

describe('currency', () => {
  it('renders with whatever symbol it is given', () => {
    expect(makeFormatMoney('S$')(1500)).toBe('S$1,500.00');
    expect(makeFormatMoney('$')(1500)).toBe('$1,500.00');
    expect(makeFormatMoney('€')(1500)).toBe('€1,500.00');
  });

  it('always shows two decimal places', () => {
    expect(makeFormatMoney('$')(1234567.8)).toBe('$1,234,567.80');
    expect(makeFormatMoney('$')(1000)).toBe('$1,000.00');
  });

  it('falls back to $ for a missing or empty symbol', () => {
    expect(makeFormatMoney(undefined)(10)).toBe('$10.00');
    expect(makeFormatMoney('')(10)).toBe('$10.00');
  });

  it('returns a dash for a value that has not been computed yet', () => {
    expect(makeFormatMoney('$')(null)).toBe('—');
    expect(makeFormatMoney('S$')(undefined)).toBe('—');
  });
});
