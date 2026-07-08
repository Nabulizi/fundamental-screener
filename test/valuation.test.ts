import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  deriveFreeCashFlow, fcfBaseOptions, defaultFcfBaseKey, usableFcfValues, computeDrivers, resolveFcfBase, detectFundamentalFlags,
  type ValuationProfile, type ValuationYear
} from '@/lib/valuation';
import { parseFinancialsReported } from '@/lib/valuationProvider';

// Build a profile from a list of annual FCF values (oldest → newest); null = missing year.
function profileWithFcf(fcfs: (number | null)[]): ValuationProfile {
  return {
    ticker: 'T', fcfTtm: null, sharesOutstanding: null, netCash: null,
    source: 'finnhub-reported', retrievedAt: '2026-01-01T00:00:00Z',
    history: fcfs.map((fcf, i) => ({
      fiscalYear: 2020 + i, fiscalPeriodEnd: null, revenue: null, operatingIncome: null,
      operatingCashFlow: null, capex: null, freeCashFlow: fcf, stockBasedCompensation: null, sharesDiluted: null,
    })),
  };
}

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

describe('fcfBaseOptions / defaultFcfBaseKey (Phase 2 availability rules)', () => {
  it('TTM only when no usable history → no selector (behaves TTM-only)', () => {
    expect(fcfBaseOptions(null, 5).map((o) => o.key)).toEqual(['ttm']);
    expect(fcfBaseOptions(profileWithFcf([null, null]), 5).map((o) => o.key)).toEqual(['ttm']);
    expect(defaultFcfBaseKey(null)).toBe('ttm');
  });

  it('3Y avg needs ≥2 usable years and labels the count', () => {
    const opts = fcfBaseOptions(profileWithFcf([10, 20]), 5); // 2 usable
    expect(opts.map((o) => o.key)).toEqual(['ttm', 'avg3']);
    const avg3 = opts.find((o) => o.key === 'avg3')!;
    expect(avg3.value).toBe(15);
    expect(avg3.label).toBe('3Y avg (2 yr)');
    expect(defaultFcfBaseKey(profileWithFcf([10, 20]))).toBe('ttm'); // <3 usable → TTM default
  });

  it('5Y avg needs ≥3 usable years; averages up to 3/5 most-recent; default flips to 3Y avg', () => {
    const p = profileWithFcf([1, 2, 3, 4, 5, 6]); // 6 usable, newest = 6
    const opts = fcfBaseOptions(p, 100);
    expect(opts.map((o) => o.key)).toEqual(['ttm', 'avg3', 'avg5']);
    expect(opts.find((o) => o.key === 'avg3')!.value).toBe(5); // (6+5+4)/3
    expect(opts.find((o) => o.key === 'avg5')!.value).toBe(4); // (6+5+4+3+2)/5
    expect(defaultFcfBaseKey(p)).toBe('avg3');
  });

  it('averages only usable years, never coercing null→0', () => {
    expect(usableFcfValues(profileWithFcf([10, null, 30]))).toEqual([30, 10]); // newest-first, nulls dropped
    const avg3 = fcfBaseOptions(profileWithFcf([10, null, 30]), 5).find((o) => o.key === 'avg3')!;
    expect(avg3.value).toBe(20); // (30+10)/2, not (30+0+10)/3
  });

  it('negative/absent TTM does not hide a positive normalized average (Phase 2 bug fix)', () => {
    // TTM null but positive 3-yr history → avg3 available, no TTM option.
    const nullTtm = fcfBaseOptions(profileWithFcf([10, 20, 30]), null);
    expect(nullTtm.map((o) => o.key)).toEqual(['avg3', 'avg5']);
    expect(nullTtm[0].value).toBe(20);
    // TTM negative but positive average → still offers avg3, drops TTM.
    const negTtm = fcfBaseOptions(profileWithFcf([10, 20]), -5);
    expect(negTtm.map((o) => o.key)).toEqual(['avg3']);
  });

  it('excludes a base whose value is not positive (no unusable negative base)', () => {
    expect(fcfBaseOptions(profileWithFcf([-100, -50]), null)).toEqual([]); // avg negative → dropped
    expect(fcfBaseOptions(null, -5)).toEqual([]); // negative TTM, no history → no base at all
  });
});

describe('computeDrivers (Phase 3)', () => {
  it('derives each driver from the AAPL fixture (latest year + recent window)', () => {
    const p = parseFinancialsReported(fixture('AAPL.financials-reported.json'), 'AAPL', AT);
    const d = computeDrivers(p);
    // Latest-year (2025) ratios: 133050/416161, 98767/416161, 12715/416161, 12863/416161.
    expect(d.operatingMargin).toBeCloseTo(31.97, 1);
    expect(d.fcfMargin).toBeCloseTo(23.73, 1);
    expect(d.capexIntensity).toBeCloseTo(3.06, 1);
    expect(d.sbcPctRevenue).toBeCloseTo(3.09, 1);
    // Window (2021→2025) metrics — split-free, real buyback:
    expect(d.revenueCagr).not.toBeNull();
    expect(d.revenueCagr!).toBeGreaterThan(0);
    expect(d.shareCountChange).toBeCloseTo(-11.03, 1); // 15.00B / 16.86B − 1
    expect(d.revenueWindowYears).toBe(4);
    expect(d.shareCountWindowYears).toBe(4);
  });

  it('tracks revenue and share-count windows separately when data differs', () => {
    const y = (over: Partial<ValuationYear>): ValuationYear => ({
      fiscalYear: 2020, fiscalPeriodEnd: null, revenue: null, operatingIncome: null,
      operatingCashFlow: null, capex: null, freeCashFlow: null, stockBasedCompensation: null, sharesDiluted: null, ...over,
    });
    // Revenue every year 2020–2024 (span 4); diluted shares only 2023–2024 (span 1).
    const p: ValuationProfile = {
      ticker: 'T', fcfTtm: null, sharesOutstanding: null, netCash: null, source: 'finnhub-reported', retrievedAt: AT,
      history: [
        y({ fiscalYear: 2020, revenue: 1000 }),
        y({ fiscalYear: 2021, revenue: 1100 }),
        y({ fiscalYear: 2022, revenue: 1200 }),
        y({ fiscalYear: 2023, revenue: 1300, sharesDiluted: 1000 }),
        y({ fiscalYear: 2024, revenue: 1400, sharesDiluted: 1050 }),
      ],
    };
    const d = computeDrivers(p);
    expect(d.revenueWindowYears).toBe(4);      // 2020 → 2024
    expect(d.shareCountWindowYears).toBe(1);   // 2023 → 2024
    expect(d.shareCountChange).toBeCloseTo(5, 5); // 1050/1000 − 1
  });

  it('degrades each metric independently to null (never coerced)', () => {
    const y = (over: Partial<ValuationYear>): ValuationYear => ({
      fiscalYear: 2024, fiscalPeriodEnd: null, revenue: null, operatingIncome: null,
      operatingCashFlow: null, capex: null, freeCashFlow: null, stockBasedCompensation: null, sharesDiluted: null, ...over,
    });
    // Revenue present + op income, but no FCF/capex/SBC/shares → only margins compute.
    const p: ValuationProfile = {
      ticker: 'T', fcfTtm: null, sharesOutstanding: null, netCash: null, source: 'finnhub-reported', retrievedAt: AT,
      history: [
        { ...y({ fiscalYear: 2023, revenue: 1000, operatingIncome: 100 }) },
        { ...y({ fiscalYear: 2024, revenue: 1200, operatingIncome: 180 }) },
      ],
    };
    const d = computeDrivers(p);
    expect(d.operatingMargin).toBeCloseTo(15, 5);   // 180/1200
    expect(d.revenueCagr).toBeCloseTo(20, 5);       // 1200/1000 over 1yr
    expect(d.fcfMargin).toBeNull();
    expect(d.capexIntensity).toBeNull();
    expect(d.sbcPctRevenue).toBeNull();
    expect(d.shareCountChange).toBeNull();           // no share data
  });

  it('empty / null profile → all-null drivers, no throw', () => {
    const d = computeDrivers(null);
    expect(d.revenueCagr).toBeNull();
    expect(d.operatingMargin).toBeNull();
    expect(d.shareCountChange).toBeNull();
    expect(d.revenueWindowYears).toBeNull();
    expect(d.shareCountWindowYears).toBeNull();
  });
});

describe('resolveFcfBase (shared effective-FCF selection)', () => {
  const opts = fcfBaseOptions(profileWithFcf([10, 20, 30]), 100); // [ttm(100), avg3(20), avg5(20)]
  it('returns the selected option and its value', () => {
    const r = resolveFcfBase(opts, 'avg3', null)!;
    expect(r.option.key).toBe('avg3');
    expect(r.effectiveFcf).toBe(20);
  });
  it('a finite custom value overrides the preset', () => {
    expect(resolveFcfBase(opts, 'ttm', 555)!.effectiveFcf).toBe(555);
  });
  it('ignores a non-finite custom value (falls back to the preset)', () => {
    expect(resolveFcfBase(opts, 'ttm', NaN)!.effectiveFcf).toBe(100);
  });
  it('falls back to the first option when the key is absent', () => {
    const r = resolveFcfBase(fcfBaseOptions(profileWithFcf([10, 20, 30]), null), 'ttm', null)!; // no ttm option
    expect(r.option.key).toBe('avg3');
  });
  it('returns null when there is no usable base', () => {
    expect(resolveFcfBase([], 'ttm', null)).toBeNull();
  });
});

describe('detectFundamentalFlags (Week 1 data-quality)', () => {
  const yr = (over: Partial<ValuationYear>): ValuationYear => ({
    fiscalYear: 2020, fiscalPeriodEnd: null, revenue: null, operatingIncome: null,
    operatingCashFlow: null, capex: null, freeCashFlow: null, stockBasedCompensation: null, sharesDiluted: null, ...over,
  });
  const mk = (years: ValuationYear[]): ValuationProfile => ({
    ticker: 'T', fcfTtm: null, sharesOutstanding: null, netCash: null, source: 'finnhub-reported', retrievedAt: AT, history: years,
  });

  it('flags outsized revenue moves, share jumps, FCF sign flips, negative FCF, missing capex, and gaps', () => {
    const p = mk([
      yr({ fiscalYear: 2020, revenue: 1000, operatingCashFlow: 200, capex: 50, freeCashFlow: 150, sharesDiluted: 1000 }),
      yr({ fiscalYear: 2021, revenue: 1800, operatingCashFlow: 100, capex: null, freeCashFlow: null, sharesDiluted: 1400 }), // +80% rev, +40% shares, missing capex
      yr({ fiscalYear: 2022, revenue: 1850, operatingCashFlow: -50, capex: 30, freeCashFlow: -80, sharesDiluted: 1420 }),   // FCF negative + sign flip vs... (2021 fcf null so no flip) 
      yr({ fiscalYear: 2024, revenue: 1900, operatingCashFlow: 300, capex: 40, freeCashFlow: 260, sharesDiluted: 1430 }),   // gap 2022->2024; FCF sign flip neg->pos
    ]);
    const flags = detectFundamentalFlags(p);
    const has = (year: number, field: string) => flags.some((f) => f.fiscalYear === year && f.field === field);
    expect(has(2021, 'revenue')).toBe(true);       // +80% > 60
    expect(has(2021, 'sharesDiluted')).toBe(true);  // +40% > 25
    expect(has(2021, 'capex')).toBe(true);          // missing capex
    expect(has(2022, 'freeCashFlow')).toBe(true);   // negative FCF
    expect(has(2024, 'freeCashFlow')).toBe(true);   // sign flip -80 -> 260
    expect(has(2024, 'history')).toBe(true);        // 2022 -> 2024 gap
  });

  it('a clean, steady history produces no flags', () => {
    const p = mk([
      yr({ fiscalYear: 2022, revenue: 1000, operatingCashFlow: 200, capex: 50, freeCashFlow: 150, sharesDiluted: 1000 }),
      yr({ fiscalYear: 2023, revenue: 1080, operatingCashFlow: 210, capex: 52, freeCashFlow: 158, sharesDiluted: 990 }),
      yr({ fiscalYear: 2024, revenue: 1150, operatingCashFlow: 220, capex: 55, freeCashFlow: 165, sharesDiluted: 985 }),
    ]);
    expect(detectFundamentalFlags(p)).toEqual([]);
  });

  it('null profile → no flags, no throw; real fixtures do not throw', () => {
    expect(detectFundamentalFlags(null)).toEqual([]);
    for (const f of ['AAPL.financials-reported.json', 'HOOD.financials-reported.json', 'PLD.financials-reported.json']) {
      expect(() => detectFundamentalFlags(parseFinancialsReported(fixture(f), 'X', AT))).not.toThrow();
    }
  });
});
