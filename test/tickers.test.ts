import { describe, it, expect } from 'vitest';
import { parseTickers } from '@/lib/tickers';

describe('parseTickers', () => {
  it('splits on commas, spaces, and newlines', () => {
    const r = parseTickers('AAPL, MSFT KO\nJPM');
    expect(r.valid).toEqual(['AAPL', 'MSFT', 'KO', 'JPM']);
  });

  it('uppercases and trims tokens', () => {
    const r = parseTickers('  aapl ,  msft ');
    expect(r.valid).toEqual(['AAPL', 'MSFT']);
  });

  it('removes duplicates while preserving first-seen order', () => {
    const r = parseTickers('AAPL, aapl, MSFT, AAPL');
    expect(r.valid).toEqual(['AAPL', 'MSFT']);
    expect(r.duplicatesRemoved).toBe(2);
  });

  it('separates invalid tokens', () => {
    const r = parseTickers('AAPL, 123, $$$, BRK.B');
    expect(r.valid).toEqual(['AAPL', 'BRK.B']);
    expect(r.invalid).toEqual(['123', '$$$']);
  });

  it('enforces the max limit and flags it', () => {
    const r = parseTickers('A B C D', 2);
    expect(r.valid).toEqual(['A', 'B']);
    expect(r.limited).toBe(true);
  });

  it('handles empty input', () => {
    const r = parseTickers('   \n  ');
    expect(r.valid).toEqual([]);
    expect(r.limited).toBe(false);
  });
});
