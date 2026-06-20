import { describe, it, expect, vi } from 'vitest';
import { createFinnhubProvider } from '@/lib/finnhub';
import { createAlphaVantageProvider } from '@/lib/alphavantage';
import { createFallbackProvider } from '@/lib/fallbackProvider';
import type { RetryOptions } from '@/lib/retry';

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

// No-op sleep / zero jitter so the 429 retry doesn't actually wait.
const fastRetry = (fetchImpl: typeof fetch): RetryOptions => ({
  fetchImpl,
  sleep: async () => {},
  jitter: () => 0
});

describe('Finnhub -> Alpha Vantage failover (real adapters, mocked HTTP)', () => {
  it('serves a rate-limited Finnhub ticker from Alpha Vantage', async () => {
    const finnhubFetch = vi.fn(async () => new Response('', { status: 429 }));
    const avFetch = vi.fn(async (url: string) => {
      if (url.includes('OVERVIEW')) {
        return json({ Symbol: 'KO', Name: 'Coca-Cola Company', Industry: 'BEVERAGES', MarketCapitalization: '268000000000', TrailingPE: '25.4', DividendYield: '0.0305', '52WeekHigh': '73.5', '52WeekLow': '57.8', Currency: 'USD' });
      }
      if (url.includes('GLOBAL_QUOTE')) return json({ 'Global Quote': { '05. price': '69.20' } });
      return json({});
    });

    const finnhub = createFinnhubProvider('finnhub-key', fastRetry(finnhubFetch as unknown as typeof fetch));
    const alpha = createAlphaVantageProvider('av-key', fastRetry(avFetch as unknown as typeof fetch));
    const provider = createFallbackProvider([finnhub, alpha]);

    const row = await provider.fetchCompany('KO');

    expect(finnhubFetch).toHaveBeenCalled(); // primary was tried (and rate-limited)
    expect(avFetch).toHaveBeenCalled(); // failover engaged
    expect(row.companyName).toBe('Coca-Cola Company');
    expect(row.industry).toBe('BEVERAGES');
    expect(row.marketCap).toBe(268_000_000_000); // raw units (Alpha Vantage convention)
    expect(row.dividendYieldPercent).toBeCloseTo(3.05, 5); // decimal -> percent
    expect(row.currentPrice).toBe(69.2);
  });

  it('does not call Alpha Vantage when Finnhub succeeds', async () => {
    const finnhubFetch = vi.fn(async (url: string) => {
      if (url.includes('/stock/profile2')) return json({ name: 'Apple Inc', ticker: 'AAPL', currency: 'USD', exchange: 'NASDAQ NMS - GLOBAL MARKET', marketCapitalization: 3_000_000 });
      if (url.includes('/stock/metric')) return json({ metric: { '52WeekLow': 164, '52WeekHigh': 260, peTTM: 31.2, dividendYieldIndicatedAnnual: 0.41 } });
      if (url.includes('/quote')) return json({ c: 228.5 });
      return json({});
    });
    const avFetch = vi.fn(async () => json({}));

    const provider = createFallbackProvider([
      createFinnhubProvider('finnhub-key', fastRetry(finnhubFetch as unknown as typeof fetch)),
      createAlphaVantageProvider('av-key', fastRetry(avFetch as unknown as typeof fetch))
    ]);

    const row = await provider.fetchCompany('AAPL');
    expect(row.companyName).toBe('Apple Inc');
    expect(row.marketCap).toBe(3_000_000 * 1_000_000); // Finnhub: millions -> raw
    expect(avFetch).not.toHaveBeenCalled();
  });
});
