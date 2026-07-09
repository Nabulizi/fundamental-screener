import { describe, it, expect, vi } from 'vitest';
import { normalizeAlphaVantage, createAlphaVantageProvider } from '@/lib/alphavantage';
import type { RetryOptions } from '@/lib/retry';

const AT = '2026-06-19T20:00:00.000Z';

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
const fastRetry = (fetchImpl: typeof fetch): RetryOptions => ({ fetchImpl, sleep: async () => {}, jitter: () => 0 });

describe('normalizeAlphaVantage', () => {
  it('maps OVERVIEW + GLOBAL_QUOTE, raw market cap, decimal yield -> percent', () => {
    const row = normalizeAlphaVantage(
      'KO',
      {
        Symbol: 'KO',
        Name: 'Coca-Cola Company',
        Industry: 'BEVERAGES',
        MarketCapitalization: '268000000000',
        TrailingPE: '25.4',
        DividendYield: '0.0305',
        '52WeekHigh': '73.5',
        '52WeekLow': '57.8',
        Currency: 'USD'
      },
      { 'Global Quote': { '05. price': '69.20' } },
      AT
    );
    expect(row.companyName).toBe('Coca-Cola Company');
    expect(row.industry).toBe('BEVERAGES');
    expect(row.marketCap).toBe(268_000_000_000); // raw, NOT x1e6
    expect(row.trailingPE).toBe(25.4);
    expect(row.dividendYieldPercent).toBeCloseTo(3.05, 5); // 0.0305 -> 3.05%
    expect(row.currentPrice).toBe(69.2);
    expect(row.source).toBe('alphavantage');
    expect(row.week52High).toBe(73.5);
  });

  it('treats "None"/"-"/"" as null (missing), but keeps a real 0', () => {
    const missing = normalizeAlphaVantage('A', { Name: 'A', PERatio: 'None', DividendYield: 'None', MarketCapitalization: '-' }, null, AT);
    expect(missing.trailingPE).toBeNull();
    expect(missing.dividendYieldPercent).toBeNull();
    expect(missing.marketCap).toBeNull();

    const zero = normalizeAlphaVantage('A', { Name: 'A', DividendYield: '0' }, null, AT);
    expect(zero.dividendYieldPercent).toBe(0); // genuine 0%, distinct from None
  });

  it('falls back to Sector when Industry is absent and normalizes non-positive P/E', () => {
    const row = normalizeAlphaVantage('A', { Name: 'A', Sector: 'TECHNOLOGY', TrailingPE: '-4' }, null, AT);
    expect(row.industry).toBe('TECHNOLOGY');
    expect(row.trailingPE).toBeNull();
  });

  it('leaves price/range null when the quote is missing', () => {
    const row = normalizeAlphaVantage('A', { Name: 'A', '52WeekLow': '1', '52WeekHigh': '2' }, null, AT);
    expect(row.currentPrice).toBeNull();
    expect(row.rangePosition).toBeNull();
  });
});

describe('createAlphaVantageProvider (adapter)', () => {
  it('keeps OVERVIEW fundamentals even when GLOBAL_QUOTE is burst-limited', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('OVERVIEW')) {
        return json({ Symbol: 'KO', Name: 'The Coca-Cola Company', Industry: 'BEVERAGES', MarketCapitalization: '341574091000', TrailingPE: '24.97', DividendYield: '0.0258', '52WeekHigh': '83.5', '52WeekLow': '64.04', Currency: 'USD' });
      }
      // GLOBAL_QUOTE returns the free-tier rate-limit message (HTTP 200 + Information)
      return json({ Information: 'Please consider spreading out your free API requests… (25 requests per day)' });
    });
    const provider = createAlphaVantageProvider('key', fastRetry(fetchImpl as unknown as typeof fetch));

    const row = await provider.fetchCompany('KO');
    expect(row.companyName).toBe('The Coca-Cola Company');
    expect(row.marketCap).toBe(341_574_091_000);
    expect(row.dividendYieldPercent).toBeCloseTo(2.58, 2);
    expect(row.currentPrice).toBeNull(); // price best-effort — not fatal
    expect(row.rangePosition).toBeNull();
  });

  it('throws RATE_LIMITED when OVERVIEW itself is rate-limited', async () => {
    const fetchImpl = vi.fn(async () => json({ Information: 'free key rate limit (25 requests per day)' }));
    const provider = createAlphaVantageProvider('key', fastRetry(fetchImpl as unknown as typeof fetch));
    await expect(provider.fetchCompany('KO')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('throws NOT_FOUND for an unknown symbol (empty OVERVIEW)', async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const provider = createAlphaVantageProvider('key', fastRetry(fetchImpl as unknown as typeof fetch));
    await expect(provider.fetchCompany('ZZZZ')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
