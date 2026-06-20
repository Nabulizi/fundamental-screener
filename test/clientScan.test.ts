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
    dividendYieldPercent: 0,
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
      const body = JSON.parse((init as RequestInit).body as string) as { input: string };
      return ok({ rows: [makeRow(body.input)], errors: [] });
    });
    const progress: number[] = [];
    const out = await runClientScan(['AAPL', 'MSFT', 'KO'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: (p) => progress.push(p.completed)
    });
    expect(out.rows.map((r) => r.ticker)).toEqual(['AAPL', 'MSFT', 'KO']);
    expect(progress.at(-1)).toBe(3);
    expect(progress).toHaveLength(3);
  });

  it('preserves successful rows when one ticker errors (partial results)', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { input: string };
      if (body.input === 'BAD') return ok({ rows: [], errors: [{ ticker: 'BAD', code: 'NOT_FOUND', message: 'no data' }] });
      return ok({ rows: [makeRow(body.input)], errors: [] });
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
      const body = JSON.parse((init as RequestInit).body as string) as { input: string; refresh: boolean };
      seen.push(body.refresh);
      return ok({ rows: [makeRow(body.input)], errors: [] });
    });
    await runClientScan(['AAPL'], { fetchImpl: fetchImpl as unknown as typeof fetch, refresh: true });
    expect(seen).toEqual([true]);
  });
});
