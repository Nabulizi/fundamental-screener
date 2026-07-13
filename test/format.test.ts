import { describe, it, expect } from 'vitest';
import { formatMarketCap, formatCurrency, formatPercent, formatReturn, formatPe, NA } from '@/lib/format';

describe('formatMarketCap', () => {
  it('uses T/B/M suffixes', () => {
    expect(formatMarketCap(3_000_000_000_000)).toBe('$3.00T');
    expect(formatMarketCap(2_500_000_000)).toBe('$2.50B');
    expect(formatMarketCap(750_000_000)).toBe('$750.00M');
  });

  it('returns N/A for null/non-finite', () => {
    expect(formatMarketCap(null)).toBe(NA);
    expect(formatMarketCap(Number.NaN)).toBe(NA);
  });

  it('respects currency symbol', () => {
    expect(formatMarketCap(1_000_000_000, 'EUR')).toBe('€1.00B');
    expect(formatMarketCap(1_000_000_000, null)).toBe('¤1.00B');
  });
});

describe('formatCurrency', () => {
  it('formats with two decimals and grouping', () => {
    expect(formatCurrency(164.08)).toBe('$164.08');
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });
  it('returns N/A for null', () => {
    expect(formatCurrency(null)).toBe(NA);
  });
});

describe('formatPercent', () => {
  it('preserves a real zero as 0.00%', () => {
    expect(formatPercent(0)).toBe('0.00%');
  });
  it('formats a percentage value', () => {
    expect(formatPercent(3.05)).toBe('3.05%');
  });
  it('returns N/A for null (missing), not 0%', () => {
    expect(formatPercent(null)).toBe(NA);
  });
});

describe('formatPe', () => {
  it('formats positive P/E', () => {
    expect(formatPe(31.2)).toBe('31.20');
  });
  it('returns N/A for null, zero, or negative', () => {
    expect(formatPe(null)).toBe(NA);
    expect(formatPe(0)).toBe(NA);
    expect(formatPe(-5)).toBe(NA);
  });
});

describe('formatReturn', () => {
  it('adds + prefix for positive values', () => {
    expect(formatReturn(9.25)).toBe('+9.25%');
  });
  it('shows negative values with minus', () => {
    expect(formatReturn(-4.82)).toBe('-4.82%');
  });
  it('formats zero without + prefix', () => {
    expect(formatReturn(0)).toBe('0.00%');
  });
  it('returns N/A for null', () => {
    expect(formatReturn(null)).toBe(NA);
  });
});
