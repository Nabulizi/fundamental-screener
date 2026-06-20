import { describe, it, expect, vi } from 'vitest';
import { createFallbackProvider } from '@/lib/fallbackProvider';
import { ProviderError, type QuoteProvider } from '@/lib/provider';
import type { ScanRow } from '@/lib/types';

function row(ticker: string, source: string): ScanRow {
  return {
    ticker,
    companyName: `${ticker} (${source})`,
    industry: 'Test',
    marketCap: 1e9,
    currency: 'USD',
    week52Low: 1,
    week52High: 2,
    trailingPE: 10,
    dividendYieldPercent: 1,
    currentPrice: 1.5,
    rangePosition: 0.5,
    retrievedAt: '2026-06-19T00:00:00.000Z'
  };
}

function provider(name: string, impl: (t: string) => Promise<ScanRow>): QuoteProvider & { fn: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(impl);
  return { name, fetchCompany: fn as unknown as QuoteProvider['fetchCompany'], fn };
}

describe('createFallbackProvider', () => {
  it('returns the primary result and never calls the backup when primary succeeds', async () => {
    const primary = provider('finnhub', async (t) => row(t, 'finnhub'));
    const backup = provider('alphavantage', async (t) => row(t, 'alphavantage'));
    const fb = createFallbackProvider([primary, backup]);

    const out = await fb.fetchCompany('AAPL');
    expect(out.companyName).toContain('finnhub');
    expect(backup.fn).not.toHaveBeenCalled();
  });

  it('falls over to the backup on RATE_LIMITED', async () => {
    const primary = provider('finnhub', async () => {
      throw new ProviderError('RATE_LIMITED', 'limited');
    });
    const backup = provider('alphavantage', async (t) => row(t, 'alphavantage'));
    const fb = createFallbackProvider([primary, backup]);

    const out = await fb.fetchCompany('AAPL');
    expect(out.companyName).toContain('alphavantage');
    expect(backup.fn).toHaveBeenCalledOnce();
  });

  it('falls over on a generic PROVIDER_ERROR', async () => {
    const primary = provider('finnhub', async () => {
      throw new ProviderError('PROVIDER_ERROR', 'boom');
    });
    const backup = provider('alphavantage', async (t) => row(t, 'alphavantage'));
    const fb = createFallbackProvider([primary, backup]);

    expect((await fb.fetchCompany('AAPL')).companyName).toContain('alphavantage');
  });

  it('does NOT fall over on NOT_FOUND (symbol genuinely missing)', async () => {
    const primary = provider('finnhub', async () => {
      throw new ProviderError('NOT_FOUND', 'no such symbol');
    });
    const backup = provider('alphavantage', async (t) => row(t, 'alphavantage'));
    const fb = createFallbackProvider([primary, backup]);

    await expect(fb.fetchCompany('ZZZZ')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(backup.fn).not.toHaveBeenCalled();
  });

  it('throws the last error when every provider fails', async () => {
    const primary = provider('finnhub', async () => {
      throw new ProviderError('RATE_LIMITED', 'limited');
    });
    const backup = provider('alphavantage', async () => {
      throw new ProviderError('PROVIDER_ERROR', 'backup down');
    });
    const fb = createFallbackProvider([primary, backup]);

    await expect(fb.fetchCompany('AAPL')).rejects.toMatchObject({ code: 'PROVIDER_ERROR', message: 'backup down' });
  });

  it('exposes a combined provider name', () => {
    const fb = createFallbackProvider([provider('finnhub', async (t) => row(t, 'a')), provider('alphavantage', async (t) => row(t, 'b'))]);
    expect(fb.name).toBe('finnhub+alphavantage');
  });
});
