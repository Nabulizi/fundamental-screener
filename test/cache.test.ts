import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, setCached, clearCache } from '@/lib/cache';
import type { ScanRow } from '@/lib/types';

function row(ticker: string, retrievedAt: string): ScanRow {
  return {
    ticker,
    companyName: ticker,
    industry: null,
    marketCap: 1,
    currency: 'USD',
    week52Low: null,
    week52High: null,
    trailingPE: null,
    dividendYieldPercent: null,
    retrievedAt
  };
}

describe('cache', () => {
  beforeEach(() => clearCache());

  it('returns a cached row before expiry and preserves its retrievedAt', () => {
    const original = row('AAPL', '2026-06-19T10:00:00.000Z');
    setCached('AAPL', original, 60, 1_000);
    const got = getCached('AAPL', 30_000); // 29s later, still fresh
    expect(got).not.toBeNull();
    expect(got?.retrievedAt).toBe('2026-06-19T10:00:00.000Z');
  });

  it('evicts an expired entry', () => {
    setCached('AAPL', row('AAPL', 'x'), 60, 1_000);
    expect(getCached('AAPL', 1_000 + 61_000)).toBeNull();
  });

  it('does not cache when ttl is zero', () => {
    setCached('AAPL', row('AAPL', 'x'), 0, 1_000);
    expect(getCached('AAPL', 1_001)).toBeNull();
  });
});
