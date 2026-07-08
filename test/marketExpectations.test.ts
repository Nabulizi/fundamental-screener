import { describe, it, expect } from 'vitest';
import { buildMarketExpectations, EXPECTATION_GAP_PP } from '@/lib/marketExpectations';
import { intrinsicDcf, impliedGrowth, type SharedAssumptions } from '@/lib/dcf';
import type { Drivers } from '@/lib/valuation';

const shared: SharedAssumptions = { costOfEquity: 0.11, terminalGrowth: 0.03, years: 10 };
const drivers = (over: Partial<Drivers> = {}): Drivers => ({
  revenueCagr: null, operatingMargin: null, fcfMargin: null, capexIntensity: null,
  sbcPctRevenue: null, shareCountChange: null, revenueWindowYears: null, shareCountWindowYears: null, ...over,
});

describe('buildMarketExpectations', () => {
  it('TSLA-like: high implied growth vs low revenue growth triggers the gap note', () => {
    const m = buildMarketExpectations({
      effectiveFcf: 4.7e9, marketCap: 1.5e12, shared,
      drivers: drivers({ revenueCagr: 2.3, fcfMargin: 6.6, operatingMargin: 4.6 }),
      revenueGrowthTTM: 2.3,
    });
    expect(m.impliedPct!).toBeGreaterThan(30);
    expect(m.gap).toBe(true);
    // Sensitivity band: lower discount → lower implied, higher discount → higher.
    expect(m.bandLowPct!).toBeLessThan(m.impliedPct!);
    expect(m.bandHighPct!).toBeGreaterThan(m.impliedPct!);
    expect(m.discountLowPct).toBe(9);
    expect(m.discountHighPct).toBe(13);
    expect(m.delivered.fcfMargin).toBe(6.6);
  });

  it('mature company: implied near delivered growth does NOT trigger the gap note', () => {
    const marketCap = intrinsicDcf({ fcf0: 100, growth: 0.06, discountRate: 0.11, terminalGrowth: 0.03, years: 10 }).equityValue;
    const m = buildMarketExpectations({
      effectiveFcf: 100, marketCap, shared, drivers: drivers({ revenueCagr: 5 }), revenueGrowthTTM: 5,
    });
    expect(m.impliedPct!).toBeCloseTo(6, 0);
    expect(m.impliedPct! - 5).toBeLessThan(EXPECTATION_GAP_PP);
    expect(m.gap).toBe(false);
  });

  it('missing drivers / revenue degrade to N/A (null), no gap without revenue', () => {
    const m = buildMarketExpectations({
      effectiveFcf: 4.7e9, marketCap: 1.5e12, shared, drivers: null, revenueGrowthTTM: null,
    });
    expect(m.delivered.revenueCagr).toBeNull();
    expect(m.delivered.fcfMargin).toBeNull();
    // No revenue to compare against and implied is in-range → no gap.
    expect(m.gap).toBe(m.impliedOutOfRange); // only true if the implied itself is clamped
  });

  it('sensitivity band near terminal-growth bound: invalid endpoint → null, never throws', () => {
    // coe 5%, band -2 → 3% discount vs 3% terminal → below the 100bps spread → null endpoint.
    const low = { costOfEquity: 0.05, terminalGrowth: 0.03, years: 10 };
    let m!: ReturnType<typeof buildMarketExpectations>;
    expect(() => { m = buildMarketExpectations({ effectiveFcf: 100, marketCap: 5000, shared: low, drivers: null, revenueGrowthTTM: null }); }).not.toThrow();
    expect(m.bandLowPct).toBeNull(); // 3% discount fails the terminal-spread guard → null, not a crash
  });

  it('card and reverse-DCF agree exactly for the same shared assumptions (single-source consistency)', () => {
    // Both derive from impliedGrowth with identical inputs, so with one shared
    // assumption set (ValuationPanel is the single source) they cannot disagree.
    for (const s of [
      { costOfEquity: 0.11, terminalGrowth: 0.03, years: 10 },
      { costOfEquity: 0.09, terminalGrowth: 0.02, years: 12 },
      { costOfEquity: 0.14, terminalGrowth: 0.04, years: 8 },
    ] as SharedAssumptions[]) {
      const card = buildMarketExpectations({ effectiveFcf: 4.7e9, marketCap: 1.5e12, shared: s, drivers: null, revenueGrowthTTM: null });
      const dcf = impliedGrowth({ fcf0: 4.7e9, discountRate: s.costOfEquity, terminalGrowth: s.terminalGrowth, years: s.years }, 1.5e12);
      expect(card.impliedPct).toBeCloseTo(dcf.growth * 100, 6);
    }
  });

  it('out-of-range implied growth still flags a gap (beyond the solvable range)', () => {
    const m = buildMarketExpectations({ effectiveFcf: 1, marketCap: 1e15, shared, drivers: null, revenueGrowthTTM: 2 });
    expect(m.impliedOutOfRange).toBe(true);
    expect(m.gap).toBe(true);
  });
});
