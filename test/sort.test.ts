import { describe, it, expect } from 'vitest';
import { sortRows } from '@/lib/sort';
import type { ScanRow } from '@/lib/types';

function row(ticker: string, marketCap: number | null): ScanRow {
  return {
    ticker,
    companyName: ticker,
    industry: null,
    marketCap,
    currency: 'USD',
    week52Low: null,
    week52High: null,
    trailingPE: null,
    dividendYieldPercent: null,
    retrievedAt: '2026-06-19T00:00:00.000Z'
  };
}

describe('sortRows', () => {
  const rows = [row('A', 100), row('B', null), row('C', 300), row('D', null)];

  it('sorts ascending with missing values last', () => {
    const out = sortRows(rows, 'marketCap', 'asc').map((r) => r.ticker);
    expect(out.slice(0, 2)).toEqual(['A', 'C']);
    expect(out.slice(2).sort()).toEqual(['B', 'D']);
  });

  it('sorts descending with missing values STILL last', () => {
    const out = sortRows(rows, 'marketCap', 'desc').map((r) => r.ticker);
    expect(out.slice(0, 2)).toEqual(['C', 'A']);
    expect(out.slice(2).sort()).toEqual(['B', 'D']);
  });

  it('does not mutate the input array', () => {
    const before = rows.map((r) => r.ticker);
    sortRows(rows, 'marketCap', 'asc');
    expect(rows.map((r) => r.ticker)).toEqual(before);
  });

  it('sorts strings by ticker', () => {
    const out = sortRows(rows, 'ticker', 'desc').map((r) => r.ticker);
    expect(out).toEqual(['D', 'C', 'B', 'A']);
  });
});
