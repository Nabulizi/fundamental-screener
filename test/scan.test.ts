import { describe, it, expect, beforeEach } from 'vitest';
import { scanTickers } from '@/lib/scan';
import { clearCache } from '@/lib/cache';
import { ProviderError, type QuoteProvider } from '@/lib/provider';
import type { ScanRow } from '@/lib/types';

function makeRow(ticker: string): ScanRow {
  return {
    ticker,
    companyName: `${ticker} Inc`,
    industry: 'Test',
    marketCap: 1_000_000_000,
    currency: 'USD',
    week52Low: 1,
    week52High: 2,
    trailingPE: 10,
    forwardPE: null,
    dividendYieldPercent: 0,
    ytdReturn: null,
    fcfYieldPercent: null,
    revenueGrowthTTM: null,
    debtToEquity: null,
    evToEbitda: null,
    retrievedAt: new Date().toISOString()
  };
}

function provider(behavior: Record<string, 'ok' | 'notfound' | 'rate'>): QuoteProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: 'fake',
    calls,
    async fetchCompany(ticker: string) {
      calls.push(ticker);
      const b = behavior[ticker] ?? 'ok';
      if (b === 'notfound') throw new ProviderError('NOT_FOUND', `No data for ${ticker}`);
      if (b === 'rate') throw new ProviderError('RATE_LIMITED', 'slow down');
      return makeRow(ticker);
    }
  };
}

describe('scanTickers', () => {
  beforeEach(() => clearCache());

  it('returns rows in input order', async () => {
    const p = provider({});
    const out = await scanTickers(['AAPL', 'MSFT', 'KO'], p, { useCache: false });
    expect(out.rows.map((r) => r.ticker)).toEqual(['AAPL', 'MSFT', 'KO']);
    expect(out.errors).toEqual([]);
  });

  it('preserves valid rows when one ticker fails (partial results)', async () => {
    const p = provider({ MSFT: 'notfound' });
    const out = await scanTickers(['AAPL', 'MSFT', 'KO'], p, { useCache: false });
    expect(out.rows.map((r) => r.ticker)).toEqual(['AAPL', 'KO']);
    expect(out.errors).toEqual([{ ticker: 'MSFT', code: 'NOT_FOUND', message: 'No data for MSFT' }]);
  });

  it('maps rate-limit failures without dropping good rows', async () => {
    const p = provider({ KO: 'rate' });
    const out = await scanTickers(['AAPL', 'KO'], p, { useCache: false });
    expect(out.rows.map((r) => r.ticker)).toEqual(['AAPL']);
    expect(out.errors[0].code).toBe('RATE_LIMITED');
  });

  it('serves the second scan from cache (no second provider call)', async () => {
    const p = provider({});
    await scanTickers(['AAPL'], p, { useCache: true, ttlSeconds: 60 });
    await scanTickers(['AAPL'], p, { useCache: true, ttlSeconds: 60 });
    expect(p.calls).toEqual(['AAPL']); // fetched once, second served from cache
  });

  it('flags fresh vs cached rows and refresh forces a fresh fetch', async () => {
    const p = provider({});
    const first = await scanTickers(['AAPL'], p, { useCache: true, ttlSeconds: 60 });
    expect(first.rows[0].cached).toBe(false);

    const second = await scanTickers(['AAPL'], p, { useCache: true, ttlSeconds: 60 });
    expect(second.rows[0].cached).toBe(true);
    expect(p.calls).toEqual(['AAPL']);

    const refreshed = await scanTickers(['AAPL'], p, { useCache: true, ttlSeconds: 60, refresh: true });
    expect(refreshed.rows[0].cached).toBe(false);
    expect(p.calls).toEqual(['AAPL', 'AAPL']); // refresh bypassed the cache read
  });

  it('preserves the original retrievedAt when served from cache', async () => {
    const p = provider({});
    const first = await scanTickers(['AAPL'], p, { useCache: true, ttlSeconds: 60 });
    const second = await scanTickers(['AAPL'], p, { useCache: true, ttlSeconds: 60 });
    expect(second.rows[0].retrievedAt).toBe(first.rows[0].retrievedAt);
  });

  it('computes lastUpdatedAt as newest row timestamp, null when empty', async () => {
    const p = provider({ AAPL: 'notfound' });
    const out = await scanTickers(['AAPL'], p, { useCache: false });
    expect(out.rows).toEqual([]);
    expect(out.lastUpdatedAt).toBeNull();
  });
});
