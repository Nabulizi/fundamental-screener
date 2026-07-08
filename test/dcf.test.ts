import { describe, it, expect } from 'vitest';
import { intrinsicDcf, impliedGrowth, computeScenarios, isInvertedRange, scenarioAssumptionsValid, scenarioInputsValid } from '@/lib/dcf';

describe('intrinsicDcf', () => {
  it('matches a hand-computed two-stage DCF', () => {
    // FCF0=100 growing 8%/yr for 5 years, then 3% perpetuity, discounted at 10%.
    const r = intrinsicDcf({ fcf0: 100, growth: 0.08, discountRate: 0.1, terminalGrowth: 0.03, years: 5 });
    expect(r.pvExplicit).toBeCloseTo(473.38, 1);
    expect(r.pvTerminal).toBeCloseTo(1342.44, 1);
    expect(r.enterpriseValue).toBeCloseTo(1815.82, 1);
  });

  it('adds net cash to reach equity value', () => {
    const r = intrinsicDcf({ fcf0: 100, growth: 0, discountRate: 0.1, terminalGrowth: 0, years: 1, netCash: 50 });
    expect(r.equityValue).toBeCloseTo(r.enterpriseValue + 50, 6);
  });

  it('throws when discount rate does not exceed terminal growth', () => {
    expect(() => intrinsicDcf({ fcf0: 100, growth: 0.05, discountRate: 0.03, terminalGrowth: 0.03 })).toThrow();
  });
});

describe('impliedGrowth', () => {
  const base = { fcf0: 100, discountRate: 0.1, terminalGrowth: 0.03, years: 10 };

  it('recovers the growth that produced a given value (round-trip)', () => {
    const target = intrinsicDcf({ ...base, growth: 0.12 }).equityValue;
    const { growth, outOfRange } = impliedGrowth(base, target);
    expect(outOfRange).toBe(false);
    expect(growth).toBeCloseTo(0.12, 3);
  });

  it('flags targets below what -50% growth can reach', () => {
    const { growth, outOfRange } = impliedGrowth(base, 1); // absurdly low market cap
    expect(outOfRange).toBe(true);
    expect(growth).toBe(-0.5);
  });
});

describe('computeScenarios / isInvertedRange (Phase 4)', () => {
  const shared = { costOfEquity: 0.11, terminalGrowth: 0.03, years: 10 };
  const growths = { bear: 0.03, base: 0.08, bull: 0.15 };

  it('per-share = equityValue / shares; ordering is fixed bear→base→bull', () => {
    const r = computeScenarios(1000, growths, shared, 200);
    expect(r.map((x) => x.label)).toEqual(['bear', 'base', 'bull']);
    for (const s of r) expect(s.perShare).toBeCloseTo(s.equityValue / 200, 6);
  });

  it('default presets produce a monotonic (non-inverted) range', () => {
    const r = computeScenarios(1000, growths, shared, 200);
    expect(r[0].equityValue).toBeLessThanOrEqual(r[1].equityValue);
    expect(r[1].equityValue).toBeLessThanOrEqual(r[2].equityValue);
    expect(isInvertedRange(r)).toBe(false);
  });

  it('missing/invalid shares → perShare null, equity value still present', () => {
    for (const shares of [null, 0, -5]) {
      const r = computeScenarios(1000, growths, shared, shares);
      expect(r.every((x) => x.perShare === null)).toBe(true);
      expect(r.every((x) => Number.isFinite(x.equityValue))).toBe(true);
    }
  });

  it('user-edited assumptions may invert the range — flagged, never sorted', () => {
    // Bull growth below bear growth → inverted equity values, order preserved.
    const r = computeScenarios(1000, { bear: 0.15, base: 0.08, bull: 0.03 }, shared, 200);
    expect(r.map((x) => x.label)).toEqual(['bear', 'base', 'bull']); // not sorted
    expect(isInvertedRange(r)).toBe(true);
  });

  it('terminal guard: terminal within 100bps of cost of equity is invalid and throws', () => {
    expect(scenarioAssumptionsValid(0.11, 0.03)).toBe(true);
    expect(scenarioAssumptionsValid(0.11, 0.10)).toBe(true);   // exactly 100bps → valid
    expect(scenarioAssumptionsValid(0.05, 0.049)).toBe(false); // 10bps spread → invalid
    expect(scenarioAssumptionsValid(0.11, 0.105)).toBe(false); // 50bps spread → invalid
    expect(() => computeScenarios(1000, growths, { costOfEquity: 0.05, terminalGrowth: 0.049, years: 10 }, 200)).toThrow();
  });
});

describe('scenarioInputsValid (fail-closed guard)', () => {
  const g = { bear: 3, base: 8, bull: 15 };
  it('accepts the defaults', () => {
    expect(scenarioInputsValid(g, 11, 3, 10)).toBe(true);
  });
  it('rejects a blank/0 or non-integer horizon (the crash case)', () => {
    expect(scenarioInputsValid(g, 11, 3, 0)).toBe(false);   // blank field → Number('')=0
    expect(scenarioInputsValid(g, 11, 3, 4)).toBe(false);   // below 5
    expect(scenarioInputsValid(g, 11, 3, 16)).toBe(false);  // above 15
    expect(scenarioInputsValid(g, 11, 3, 10.5)).toBe(false); // non-integer
  });
  it('rejects out-of-range growth / cost of equity / terminal', () => {
    expect(scenarioInputsValid({ ...g, bull: 41 }, 11, 3, 10)).toBe(false);
    expect(scenarioInputsValid({ ...g, bear: -21 }, 11, 3, 10)).toBe(false);
    expect(scenarioInputsValid(g, 21, 3, 10)).toBe(false);  // CoE > 20
    expect(scenarioInputsValid(g, 4, 3, 10)).toBe(false);   // CoE < 5
    expect(scenarioInputsValid(g, 11, 7, 10)).toBe(false);  // terminal > 6
    expect(scenarioInputsValid(g, 11, 10.5, 10)).toBe(false); // terminal within 100bps of CoE
  });
  it('rejects non-finite values', () => {
    expect(scenarioInputsValid(g, NaN, 3, 10)).toBe(false);
    expect(scenarioInputsValid({ ...g, base: NaN }, 11, 3, 10)).toBe(false);
    expect(scenarioInputsValid(g, 11, 3, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
