import { describe, it, expect } from 'vitest';
import { buildCrossCheck } from '@/lib/crossCheck';
import type { ScanRow } from '@/lib/types';

function row(over: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'AAPL', companyName: 'Apple', industry: 'Technology', marketCap: 3e12, currency: 'USD',
    week52Low: null, week52High: null, trailingPE: 31, forwardPE: null, dividendYieldPercent: 0.5,
    ytdReturn: null, fcfYieldPercent: null, revenueGrowthTTM: null, debtToEquity: null, evToEbitda: null,
    currentPrice: 200, source: 'finnhub', retrievedAt: '2026-01-01T00:00:00Z', ...over,
  };
}

describe('buildCrossCheck — availability guards', () => {
  it('unavailable when no secondary provider is configured', () => {
    const c = buildCrossCheck({ primary: row(), secondary: null, hasSecondaryProvider: false });
    expect(c.available).toBe(false);
    expect(c.reason).toMatch(/not configured/i);
  });
  it('unavailable when the PRIMARY is itself Alpha Vantage (no independent source)', () => {
    const c = buildCrossCheck({ primary: row({ source: 'alphavantage' }), secondary: row(), hasSecondaryProvider: true });
    expect(c.available).toBe(false);
    expect(c.reason).toMatch(/already Alpha Vantage/i);
  });
  it('unavailable when the secondary fetch failed', () => {
    const c = buildCrossCheck({ primary: row(), secondary: null, hasSecondaryProvider: true });
    expect(c.available).toBe(false);
    expect(c.reason).toMatch(/unavailable/i);
  });
});

describe('buildCrossCheck — field comparison', () => {
  it('agrees within tolerance, differs beyond, unavailable when a side is missing', () => {
    const primary = row({ marketCap: 3e12, currentPrice: 200, trailingPE: 31, dividendYieldPercent: 0.5 });
    const secondary = row({
      source: 'alphavantage',
      marketCap: 3.05e12,   // +1.7% ≤ 3% → agree
      currentPrice: 220,    // +10% > 3% → differ
      trailingPE: 31.5,     // +1.6% ≤ 5% → agree
      dividendYieldPercent: null, // missing → unavailable
    });
    const c = buildCrossCheck({ primary, secondary, hasSecondaryProvider: true });
    expect(c.available).toBe(true);
    const by = Object.fromEntries(c.fields.map((f) => [f.key, f.status]));
    expect(by.marketCap).toBe('agree');
    expect(by.currentPrice).toBe('differ');
    expect(by.trailingPE).toBe('agree');
    expect(by.dividendYieldPercent).toBe('unavailable');
    expect(c.fields.find((f) => f.key === 'currentPrice')!.pctDiff).toBeCloseTo(0.10, 5);
  });
});
