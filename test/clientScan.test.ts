import { describe, it, expect, vi } from 'vitest';
import { runClientScan } from '@/lib/clientScan';
import type { ScanRow } from '@/lib/types';

function makeRow(ticker: string, cached = false): ScanRow {
  return {
    ticker,
    companyName: `${ticker} Inc`,
    industry: 'Test',
    marketCap: 1e9,
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
    cached,
    retrievedAt: '2026-06-19T00:00:00.000Z'
  };
}

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('runClientScan', () => {
  it('aggregates rows in input order and reports progress for each ticker', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tickers: string[] };
      return ok({ rows: body.tickers.map((ticker) => makeRow(ticker)), errors: [] });
    });
    const progress: number[] = [];
    const out = await runClientScan(['AAPL', 'MSFT', 'KO'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: (p) => progress.push(p.completed)
    });
    expect(out.rows.map((r) => r.ticker)).toEqual(['AAPL', 'MSFT', 'KO']);
    expect(progress.at(-1)).toBe(3);
    expect(progress).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves successful rows when one ticker errors (partial results)', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tickers: string[] };
      return ok({
        rows: body.tickers.filter((ticker) => ticker !== 'BAD').map((ticker) => makeRow(ticker)),
        errors: body.tickers.includes('BAD') ? [{ ticker: 'BAD', code: 'NOT_FOUND', message: 'no data' }] : [],
      });
    });
    const out = await runClientScan(['AAPL', 'BAD', 'KO'], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.rows.map((r) => r.ticker)).toEqual(['AAPL', 'KO']);
    expect(out.errors).toEqual([{ ticker: 'BAD', code: 'NOT_FOUND', message: 'no data' }]);
  });

  it('maps a non-ok HTTP response to a per-ticker error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 502 }));
    const out = await runClientScan(['AAPL'], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.rows).toEqual([]);
    expect(out.errors[0].code).toBe('PROVIDER_ERROR');
  });

  it('forwards the refresh flag to the API', async () => {
    const seen: boolean[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tickers: string[]; refresh: boolean };
      seen.push(body.refresh);
      return ok({ rows: body.tickers.map((ticker) => makeRow(ticker)), errors: [] });
    });
    await runClientScan(['AAPL'], { fetchImpl: fetchImpl as unknown as typeof fetch, refresh: true });
    expect(seen).toEqual([true]);
  });

  it('streams rows and errors progressively via onRow/onError', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tickers: string[] };
      return ok({
        rows: body.tickers.filter((ticker) => ticker !== 'BAD').map((ticker) => makeRow(ticker)),
        errors: body.tickers.includes('BAD') ? [{ ticker: 'BAD', code: 'NOT_FOUND', message: 'no data' }] : [],
      });
    });
    const streamed: string[] = [];
    const failed: string[] = [];
    const out = await runClientScan(['AAPL', 'BAD'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      concurrency: 1,
      onRow: (r) => streamed.push(r.ticker),
      onError: (e) => failed.push(e.ticker)
    });
    expect(streamed).toEqual(['AAPL']);
    expect(failed).toEqual(['BAD']);
    expect(out.aborted).toBe(false);
  });

  it('cancellation keeps completed rows and reports aborted', async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tickers: string[] };
      if (body.tickers[0] === 'AAPL') return ok({ rows: [makeRow('AAPL')], errors: [] });
      // Abort mid-scan: the remaining ticker rejects like a real aborted fetch.
      controller.abort();
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    const out = await runClientScan(['AAPL', 'MSFT', 'KO'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      concurrency: 1,
      batchSize: 1,
      signal: controller.signal,
      onProgress: (p) => progress.push(p.completed),
    });
    expect(out.aborted).toBe(true);
    expect(out.rows.map((r) => r.ticker)).toEqual(['AAPL']); // partials preserved
    expect(fetchImpl).toHaveBeenCalledTimes(2); // KO was never started
    expect(progress).toEqual([1]); // the aborted request is not reported as completed
  });

  it('maps HTTP 429 to RATE_LIMITED for every ticker and preserves Retry-After', async () => {
    const out = await runClientScan(['AAPL', 'MSFT'], {
      fetchImpl: vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '17' } })) as unknown as typeof fetch,
    });
    expect(out.errors.map((e) => e.code)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    expect(out.errors[0].message).toContain('17s');
  });
});
