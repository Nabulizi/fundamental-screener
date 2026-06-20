import { describe, it, expect } from 'vitest';
import { computeRangePosition, clampFraction } from '@/lib/range';

describe('computeRangePosition', () => {
  it('returns 0 at the low, 1 at the high, 0.5 in the middle', () => {
    expect(computeRangePosition(10, 10, 20)).toBe(0);
    expect(computeRangePosition(20, 10, 20)).toBe(1);
    expect(computeRangePosition(15, 10, 20)).toBe(0.5);
  });

  it('preserves raw values outside the range (no clamping)', () => {
    expect(computeRangePosition(25, 10, 20)).toBe(1.5);
    expect(computeRangePosition(5, 10, 20)).toBe(-0.5);
  });

  it('returns null for equal high/low (flat range)', () => {
    expect(computeRangePosition(10, 10, 10)).toBeNull();
  });

  it('returns null for inverted/invalid range (high < low)', () => {
    expect(computeRangePosition(15, 20, 10)).toBeNull();
  });

  it('returns null when any input is missing or non-finite', () => {
    expect(computeRangePosition(null, 10, 20)).toBeNull();
    expect(computeRangePosition(15, null, 20)).toBeNull();
    expect(computeRangePosition(15, 10, null)).toBeNull();
    expect(computeRangePosition(Number.NaN, 10, 20)).toBeNull();
  });
});

describe('clampFraction', () => {
  it('clamps to [0,1]', () => {
    expect(clampFraction(1.5)).toBe(1);
    expect(clampFraction(-0.5)).toBe(0);
    expect(clampFraction(0.42)).toBe(0.42);
  });
  it('returns 0 for non-finite', () => {
    expect(clampFraction(Number.NaN)).toBe(0);
  });
});
