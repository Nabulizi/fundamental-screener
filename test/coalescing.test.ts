import { beforeEach, describe, expect, it } from 'vitest';
import { scanTickers } from '@/lib/scan';
import { clearCache } from '@/lib/cache';
import { clearBreakers } from '@/lib/circuitBreaker';
import { ProviderError, type QuoteProvider } from '@/lib/provider';
import type { ScanRow } from '@/lib/types';

function makeRow(ticker: string): ScanRow {
  return {
    ticker, companyName: `${ticker} Inc`, industry: 'Test', marketCap: 1e9, currency: 'USD',
    week52Low: 1, week52High: 2, trailingPE: 10, forwardPE: null, dividendYieldPercent: 0,
    ytdReturn: null, fcfYieldPercent: null, revenueGrowthTTM: null, debtToEquity: null,
    evToEbitda: null, retrievedAt: new Date().toISOString()
  };
}

/** Provider whose fetches stay pending until released, counting real calls. */
function slowProvider(fail = false) {
  const calls: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const provider: QuoteProvider = {
    name: 'fake',
    async fetchCompany(ticker: string) {
      calls.push(ticker);
      await gate;
      if (fail) throw new ProviderError('PROVIDER_ERROR', 'boom');
      return makeRow(ticker);
    }
  };
  return { provider, calls, release: () => release() };
}

describe('in-flight coalescing and scan telemetry', () => {
  beforeEach(() => {
    clearCache();
    clearBreakers();
  });

  it('two concurrent scans of the same ticker share one provider call', async () => {
    const { provider, calls, release } = slowProvider();
    const first = scanTickers(['AAPL'], provider, { useCache: false });
    const second = scanTickers(['AAPL'], provider, { useCache: false });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toEqual(['AAPL']); // ONE quota-bearing call, not two
    expect(a.rows[0].ticker).toBe('AAPL');
    expect(b.rows[0].ticker).toBe('AAPL');
    const totals = [a.telemetry!, b.telemetry!];
    expect(totals.reduce((s, t) => s + t.providerCalls, 0)).toBe(1);
    expect(totals.reduce((s, t) => s + t.coalescedJoins, 0)).toBe(1);
  });

  it('refresh scans also coalesce concurrent duplicates', async () => {
    const { provider, calls, release } = slowProvider();
    const first = scanTickers(['MSFT'], provider, { refresh: true });
    const second = scanTickers(['MSFT'], provider, { refresh: true });
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual(['MSFT']);
  });

  it('a coalesced failure reaches every waiter and is not sticky', async () => {
    const { provider, release } = slowProvider(true);
    const first = scanTickers(['NVDA'], provider, { useCache: false });
    const second = scanTickers(['NVDA'], provider, { useCache: false });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.errors[0].code).toBe('PROVIDER_ERROR');
    expect(b.errors[0].code).toBe('PROVIDER_ERROR');
    expect(a.telemetry!.failures + b.telemetry!.failures).toBe(2);
    // The in-flight entry is gone: a fresh scan makes a NEW call.
    const retry = slowProvider();
    const third = scanTickers(['NVDA'], retry.provider, { useCache: false });
    retry.release();
    await third;
    expect(retry.calls).toEqual(['NVDA']);
  });

  it('distinct tickers are never coalesced together', async () => {
    const { provider, calls, release } = slowProvider();
    const scan = scanTickers(['AAPL', 'MSFT'], provider, { useCache: false });
    release();
    const res = await scan;
    expect(calls.sort()).toEqual(['AAPL', 'MSFT']);
    expect(res.telemetry).toEqual({ providerCalls: 2, cacheHits: 0, coalescedJoins: 0, failures: 0 });
  });

  it('reports cache hits: a second sequential scan spends no provider calls', async () => {
    const { provider, calls, release } = slowProvider();
    release();
    await scanTickers(['KO'], provider, { ttlSeconds: 60 });
    const second = await scanTickers(['KO'], provider, { ttlSeconds: 60 });
    expect(calls).toEqual(['KO']);
    expect(second.telemetry).toEqual({ providerCalls: 0, cacheHits: 1, coalescedJoins: 0, failures: 0 });
  });
});
