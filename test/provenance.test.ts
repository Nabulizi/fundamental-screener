import { describe, it, expect } from 'vitest';
import { buildDataProvenance } from '@/lib/provenance';
import type { ValuationProfile, ValuationYear } from '@/lib/valuation';

const yr = (fy: number, fcf: number | null): ValuationYear => ({
  fiscalYear: fy, fiscalPeriodEnd: null, revenue: 1000, operatingIncome: null, operatingCashFlow: null,
  capex: null, freeCashFlow: fcf, stockBasedCompensation: null, sharesDiluted: null,
});
const profile = (fcfs: (number | null)[]): ValuationProfile => ({
  ticker: 'T', fcfTtm: null, sharesOutstanding: null, netCash: null, source: 'finnhub-reported',
  retrievedAt: '2026-01-01T00:00:00Z', history: fcfs.map((f, i) => yr(2020 + i, f)),
});
const AT = '2026-07-08T00:00:00Z';

describe('buildDataProvenance', () => {
  it('passes through source/freshness and computes coverage + available bases', () => {
    const p = buildDataProvenance({
      source: 'finnhub', cached: true, retrievedAt: AT, profile: profile([10, 20, 30]),
      fcf0: 5, isFinancial: false, insufficientData: false,
    });
    expect(p.source).toBe('finnhub');
    expect(p.cached).toBe(true);
    expect(p.historyYears).toBe(3);
    expect(p.historySource).toBe('finnhub-reported');
    expect(p.availableBaseLabels).toEqual(['TTM', '3Y avg (3 yr)', '5Y avg (3 yr)']);
    expect(p.fcfGated).toBe(false);
  });

  it('missing source (pre-field snapshot) reads as null, never throws', () => {
    const p = buildDataProvenance({ retrievedAt: AT, profile: null, fcf0: null, isFinancial: false, insufficientData: false });
    expect(p.source).toBeNull();
    expect(p.cached).toBe(false);
    expect(p.historyYears).toBe(0);
    expect(p.availableBaseLabels).toEqual([]);
  });

  it('a balance-sheet financial is FCF-gated with no available bases', () => {
    const p = buildDataProvenance({
      source: 'finnhub', retrievedAt: AT, profile: profile([10, 20, 30]), fcf0: 5,
      isFinancial: true, insufficientData: false,
    });
    expect(p.fcfGated).toBe(true);
    expect(p.availableBaseLabels).toEqual([]); // gated → none offered
  });

  it('carries the insufficient-data flag', () => {
    const p = buildDataProvenance({ source: 'finnhub', retrievedAt: AT, profile: null, fcf0: null, isFinancial: false, insufficientData: true });
    expect(p.insufficientData).toBe(true);
  });
});
