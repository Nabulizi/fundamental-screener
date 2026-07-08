import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveFreeCashFlow } from '@/lib/valuation';
import { parseFinancialsReported } from '@/lib/valuationProvider';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/valuation/${name}`, import.meta.url)), 'utf8'));
}
const AT = '2026-07-07T00:00:00.000Z';

describe('deriveFreeCashFlow', () => {
  it('is OCF − |capex|, capex normalized positive', () => {
    expect(deriveFreeCashFlow(100, 30)).toBe(70);
    expect(deriveFreeCashFlow(100, -30)).toBe(70); // robust to either sign
  });
  it('returns null (never 0) when either input is missing', () => {
    expect(deriveFreeCashFlow(100, null)).toBeNull();
    expect(deriveFreeCashFlow(null, 30)).toBeNull();
  });
});

describe('parseFinancialsReported — AAPL (full history)', () => {
  const p = parseFinancialsReported(fixture('AAPL.financials-reported.json'), 'AAPL', AT);
  const y2025 = p.history.find((y) => y.fiscalYear === 2025)!;

  it('extracts annual history oldest → newest', () => {
    expect(p.source).toBe('finnhub-reported');
    expect(p.history.length).toBeGreaterThanOrEqual(10);
    expect(p.history[0].fiscalYear).toBeLessThan(p.history[p.history.length - 1].fiscalYear);
  });
  it('derives FCF = OCF − capex for 2025', () => {
    expect(y2025.operatingCashFlow).toBe(111_482_000_000);
    expect(y2025.capex).toBe(12_715_000_000); // normalized positive
    expect(y2025.freeCashFlow).toBe(98_767_000_000);
  });
  it('pulls revenue, operating income, SBC (not the tax-withholding line), diluted shares', () => {
    expect(y2025.revenue).toBe(416_161_000_000);
    expect(y2025.operatingIncome).toBe(133_050_000_000);
    expect(y2025.stockBasedCompensation).toBe(12_863_000_000);
    expect(y2025.sharesDiluted).toBe(15_004_697_000);
  });
  it('sets latest diluted shares and a non-null net cash', () => {
    expect(p.sharesOutstanding).toBe(15_004_697_000);
    expect(p.netCash).not.toBeNull(); // cash − (term debt current + noncurrent)
  });
});

describe('parseFinancialsReported — sector caveats', () => {
  it('HOOD (broker): OCF present but no capex line → FCF null, not coerced', () => {
    const p = parseFinancialsReported(fixture('HOOD.financials-reported.json'), 'HOOD', AT);
    const latest = p.history[p.history.length - 1];
    expect(latest.operatingCashFlow).not.toBeNull();
    expect(latest.capex).toBeNull();
    expect(latest.freeCashFlow).toBeNull();
    expect(latest.revenue).not.toBeNull();
  });
  it('PLD (REIT): real-estate acquisition is excluded → FCF null (sector caveat)', () => {
    const p = parseFinancialsReported(fixture('PLD.financials-reported.json'), 'PLD', AT);
    const latest = p.history[p.history.length - 1];
    expect(latest.operatingCashFlow).not.toBeNull();
    expect(latest.capex).toBeNull();
    expect(latest.freeCashFlow).toBeNull();
    expect(latest.revenue).not.toBeNull(); // uses us-gaap_Revenues
  });
});

describe('parseFinancialsReported — missing / partial data', () => {
  it('empty payload → empty history, null source, null aggregates', () => {
    const p = parseFinancialsReported({ data: [] }, 'ZZZ', AT);
    expect(p.history).toEqual([]);
    expect(p.source).toBeNull();
    expect(p.sharesOutstanding).toBeNull();
    expect(p.netCash).toBeNull();
  });
  it('malformed payload does not throw', () => {
    expect(() => parseFinancialsReported(null, 'ZZZ', AT)).not.toThrow();
    expect(() => parseFinancialsReported({ nope: 1 }, 'ZZZ', AT)).not.toThrow();
  });
  it('partial year (OCF, no capex) yields null FCF but keeps OCF', () => {
    const raw = { data: [{ year: 2024, quarter: 0, endDate: '2024-12-31', filedDate: '2025-02-01',
      report: { cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', value: 500 }], ic: [], bs: [] } }] };
    const p = parseFinancialsReported(raw, 'ZZZ', AT);
    expect(p.history[0].operatingCashFlow).toBe(500);
    expect(p.history[0].capex).toBeNull();
    expect(p.history[0].freeCashFlow).toBeNull();
  });
  it('dedupes a restated fiscal year to the most-recently-filed entry', () => {
    const raw = { data: [
      { year: 2023, quarter: 0, filedDate: '2024-02-01', report: { cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', value: 100 }] } },
      { year: 2023, quarter: 0, filedDate: '2025-02-01', report: { cf: [{ concept: 'us-gaap_NetCashProvidedByUsedInOperatingActivities', value: 111 }] } },
    ] };
    const p = parseFinancialsReported(raw, 'ZZZ', AT);
    expect(p.history).toHaveLength(1);
    expect(p.history[0].operatingCashFlow).toBe(111);
  });
});
