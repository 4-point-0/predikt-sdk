import { describe, expect, it } from 'vitest';
import { fromBaseUnits, toBaseUnits } from '../src/index.js';

describe('toBaseUnits', () => {
  it.each([
    ['2.5', '2500000'],
    ['1', '1000000'],
    ['0.000001', '1'],
    ['.5', '500000'],
    ['5.', '5000000'],
    ['0', '0'],
    ['-0.057', '-57000'],
    ['-0', '0'],
    [' 12.34 ', '12340000'],
    ['123456789012345678901234567890', '123456789012345678901234567890000000'],
    [2.5, '2500000'],
    [0.1, '100000'],
  ])('%j → %s', (input, expected) => {
    expect(toBaseUnits(input)).toBe(expected);
  });

  it.each(['1.0000001', '', '.', 'abc', '1e6', '1,5', '--1', 1e-7, Number.NaN])('rejects %j', (input) => {
    expect(() => toBaseUnits(input)).toThrow(RangeError);
  });
});

describe('fromBaseUnits', () => {
  it.each([
    ['2500000', '2.5'],
    ['1000000', '1'],
    ['1', '0.000001'],
    ['0', '0'],
    ['5054026', '5.054026'],
    ['-57000', '-0.057'],
    [2500000n, '2.5'],
  ])('%s → %s', (input, expected) => {
    expect(fromBaseUnits(input)).toBe(expected);
  });

  it('round-trips', () => {
    for (const value of ['0.395725', '13.07', '0.01', '1000000']) {
      expect(fromBaseUnits(toBaseUnits(value))).toBe(value);
    }
  });

  it.each(['1.5', 'abc', ''])('rejects %j', (input) => {
    expect(() => fromBaseUnits(input)).toThrow(RangeError);
  });
});
