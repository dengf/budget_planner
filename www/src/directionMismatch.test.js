import { describe, expect, it } from 'vitest';
import { directionMismatch } from './directionMismatch';

describe('directionMismatch', () => {
  it('flags a positive amount against an expense category', () => {
    expect(directionMismatch('45', false)).toBe(true);
  });

  it('flags a negative amount against an income category', () => {
    expect(directionMismatch('-3000', true)).toBe(true);
  });

  it('does not flag a negative amount against an expense category', () => {
    expect(directionMismatch('-45', false)).toBe(false);
  });

  it('does not flag a positive amount against an income category', () => {
    expect(directionMismatch('3000', true)).toBe(false);
  });

  it('stays quiet while the amount field is still empty', () => {
    expect(directionMismatch('', false)).toBe(false);
    expect(directionMismatch('', true)).toBe(false);
  });

  it('stays quiet on an unparseable amount rather than guessing', () => {
    expect(directionMismatch('abc', false)).toBe(false);
  });

  it('stays quiet on a zero amount, which has no direction to mismatch', () => {
    expect(directionMismatch('0', false)).toBe(false);
    expect(directionMismatch('0', true)).toBe(false);
  });
});
