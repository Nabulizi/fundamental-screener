import { describe, it, expect } from 'vitest';
import { buildPeerComparison } from '@/lib/peers';
import type { ScanRow } from '@/lib/types';

function row(over: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'X', companyName: 'X Co', industry: 'Technology', marketCap: 1e9, currency: 'USD',
    week52Low: null, week52High: null, trailingPE: null, forwardPE: null, dividendYieldPercent: null,
    ytdReturn: null, fcfYieldPercent: 5, revenueGrowthTTM: 10, debtToEquity: null, evToEbitda: 15,
    operatingMarginTTM: 20, retrievedAt: '2026-01-01T00:00:00Z', ...over,
  };
}

describe('buildPeerComparison', () => {
  it('pins the selected company first, then peers in order', () => {
    const m = buildPeerComparison(row({ ticker: 'AAPL' }), [row({ ticker: 'MSFT' }), row({ ticker: 'GOOGL' })]);
    expect(m.rows.map((r) => r.ticker)).toEqual(['AAPL', 'MSFT', 'GOOGL']);
    expect(m.rows[0].selected).toBe(true);
    expect(m.rows.slice(1).every((r) => !r.selected)).toBe(true);
  });

  it('dedupes peers and drops any peer equal to the selected ticker', () => {
    const m = buildPeerComparison(row({ ticker: 'AAPL' }), [row({ ticker: 'MSFT' }), row({ ticker: 'MSFT' }), row({ ticker: 'AAPL' })]);
    expect(m.rows.map((r) => r.ticker)).toEqual(['AAPL', 'MSFT']);
  });

  it('keeps failed peers visible as unavailable rows with a null cell', () => {
    const m = buildPeerComparison(row({ ticker: 'AAPL' }), [row({ ticker: 'MSFT' })], ['ZZZZ']);
    const zz = m.rows.find((r) => r.ticker === 'ZZZZ')!;
    expect(zz.unavailable).toBe(true);
    expect(zz.cell).toBeNull();
  });

  it('balance-sheet financials show FCF yield as n.m. and are excluded from its median', () => {
    const jpm = row({ ticker: 'JPM', industry: 'Banks', fcfYieldPercent: 30 });
    const m = buildPeerComparison(row({ ticker: 'AAPL' }), [jpm]);
    const jpmRow = m.rows.find((r) => r.ticker === 'JPM')!;
    expect(jpmRow.cell!.fcfYieldNm).toBe(true);
    expect(jpmRow.cell!.fcfYield).toBeNull();
  });

  it('per-column median excludes the selected company and needs ≥3 peer values', () => {
    const sel = row({ ticker: 'AAPL', evToEbitda: 100 }); // selected must not sway the median
    const peers = [row({ ticker: 'A', evToEbitda: 10 }), row({ ticker: 'B', evToEbitda: 20 }), row({ ticker: 'C', evToEbitda: 30 })];
    const m = buildPeerComparison(sel, peers);
    expect(m.medians!.n).toBe(3);
    expect(m.medians!.evToEbitda).toBe(20); // median(10,20,30), selected 100 excluded

    // Only 2 peers → no median row at all.
    expect(buildPeerComparison(sel, peers.slice(0, 2)).medians).toBeNull();
  });

  it('a column with <3 non-null peer values yields a null median for that column', () => {
    const peers = [
      row({ ticker: 'A', evToEbitda: 10, operatingMarginTTM: null }),
      row({ ticker: 'B', evToEbitda: 20, operatingMarginTTM: null }),
      row({ ticker: 'C', evToEbitda: 30, operatingMarginTTM: 25 }),
    ];
    const m = buildPeerComparison(row({ ticker: 'AAPL' }), peers);
    expect(m.medians!.evToEbitda).toBe(20);         // 3 values
    expect(m.medians!.operatingMarginTTM).toBeNull(); // only 1 value → null (never coerced)
  });
});
