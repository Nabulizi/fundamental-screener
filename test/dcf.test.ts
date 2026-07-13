import { describe, it, expect } from 'vitest';
import { intrinsicDcf, impliedGrowth, terminalContribution, sensitivityGrid, computeScenarios, isInvertedRange, scenarioAssumptionsValid, scenarioInputsValid, marketImpliedGrowthPct, seedScenarioGrowths } from '@/lib/dcf';

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
    expect(scenarioInputsValid({ ...g, bull: 101 }, 11, 3, 10)).toBe(false); // max is 100
    expect(scenarioInputsValid({ ...g, bull: 40 }, 11, 3, 10)).toBe(true);   // 40 now in range
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

describe('marketImpliedGrowthPct / seedScenarioGrowths (Phase 4 anchoring)', () => {
  const shared = { costOfEquity: 0.11, terminalGrowth: 0.03, years: 10 };

  it('TSLA-like: tiny FCF base under a huge market cap seeds Base near the implied anchor, not 8%', () => {
    const { pct, outOfRange } = marketImpliedGrowthPct(4.7e9, 1.5e12, shared);
    expect(outOfRange).toBe(false);
    expect(pct!).toBeGreaterThan(30); // ~49% — the market's number, not a universal 8
    const g = seedScenarioGrowths(pct);
    expect(g.base).toBeGreaterThan(30);
    expect(g.bear).toBe(g.base - 10);
    expect(g.bull).toBe(g.base + 10);
  });

  it('mature stock: a reasonable market cap round-trips to a single-digit anchor', () => {
    const marketCap = intrinsicDcf({ fcf0: 100, growth: 0.06, discountRate: 0.11, terminalGrowth: 0.03, years: 10 }).equityValue;
    const { pct } = marketImpliedGrowthPct(100, marketCap, shared);
    expect(pct!).toBeCloseTo(6, 0);
    expect(seedScenarioGrowths(pct).base).toBe(6);
  });

  it('implied above the range is clamped to 100 and flagged', () => {
    const { pct, outOfRange } = marketImpliedGrowthPct(1, 1e15, shared);
    expect(outOfRange).toBe(true);
    expect(pct).toBe(100);
    const g = seedScenarioGrowths(pct);
    expect(g.base).toBe(100);
    expect(g.bull).toBe(100); // clamp(110)
  });

  it('no anchor → neutral 3/8/15 fallback; null inputs → null', () => {
    expect(seedScenarioGrowths(null)).toEqual({ bear: 3, base: 8, bull: 15 });
    expect(marketImpliedGrowthPct(100, null, shared).pct).toBeNull();
    expect(marketImpliedGrowthPct(-5, 1e9, shared).pct).toBeNull();
    expect(marketImpliedGrowthPct(100, 1e9, { costOfEquity: 0.05, terminalGrowth: 0.049, years: 10 }).pct).toBeNull();
  });

  it('invalid years (cleared Horizon → 0, or non-finite) fails closed, never throws', () => {
    for (const years of [0, -1, NaN, Number.POSITIVE_INFINITY]) {
      let out!: { pct: number | null; outOfRange: boolean };
      expect(() => { out = marketImpliedGrowthPct(4.7e9, 1.5e12, { costOfEquity: 0.11, terminalGrowth: 0.03, years }); }).not.toThrow();
      expect(out).toEqual({ pct: null, outOfRange: false });
    }
  });
});

describe('terminal contribution (P3-A)', () => {
  it('is pvTerminal over total present value, flagged when dominant', () => {
    expect(terminalContribution({ pvExplicit: 25, pvTerminal: 75 })).toEqual({ fraction: 0.75, dominant: true });
    expect(terminalContribution({ pvExplicit: 50, pvTerminal: 50 })).toEqual({ fraction: 0.5, dominant: false });
    expect(terminalContribution({ pvExplicit: 0, pvTerminal: 0 })).toEqual({ fraction: 0, dominant: false });
  });

  it('matches intrinsicDcf output on a real case', () => {
    const r = intrinsicDcf({ fcf0: 100, discountRate: 0.11, growth: 0.08, terminalGrowth: 0.03 });
    const tc = terminalContribution(r);
    expect(tc.fraction).toBeCloseTo(r.pvTerminal / r.enterpriseValue, 12);
  });
});

describe('sensitivity grid (P3-A)', () => {
  it('centers on the current assumptions and matches intrinsicDcf there', () => {
    const g = sensitivityGrid(100, 0.08, 10, 11, 3);
    expect(g.coePcts).toEqual([9, 10, 11, 12, 13]);
    expect(g.terminalPcts).toEqual([2, 2.5, 3, 3.5, 4]);
    const center = g.values[g.center.terminalIdx][g.center.coeIdx];
    expect(center).toBeCloseTo(
      intrinsicDcf({ fcf0: 100, growth: 0.08, discountRate: 0.11, terminalGrowth: 0.03, years: 10 }).equityValue,
      6
    );
  });

  it('value falls as cost of equity rises and rises with terminal growth', () => {
    const g = sensitivityGrid(100, 0.08, 10, 11, 3);
    const row = g.values[g.center.terminalIdx] as number[];
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThan(row[i - 1]);
    const col = g.values.map((r) => r[g.center.coeIdx]) as number[];
    for (let i = 1; i < col.length; i++) expect(col[i]).toBeGreaterThan(col[i - 1]);
  });

  it('nulls cells where terminal growth crowds the cost of equity', () => {
    const g = sensitivityGrid(100, 0.08, 10, 5, 6);
    // At CoE 5% every terminal step ≥ 4% violates the 100 bps spread.
    expect(g.values[g.terminalPcts.indexOf(6)][g.coePcts.indexOf(5)]).toBeNull();
    expect(g.values[g.terminalPcts.indexOf(5)][g.coePcts.indexOf(7)]).not.toBeNull();
  });

  it('clamps and dedupes steps at the editable bounds', () => {
    const g = sensitivityGrid(100, 0.08, 10, 5, 0);
    expect(g.coePcts).toEqual([5, 6, 7]);       // 3 and 4 clamp to 5
    expect(g.terminalPcts).toEqual([0, 0.5, 1]); // −1 and −0.5 clamp to 0
    expect(g.center).toEqual({ coeIdx: 0, terminalIdx: 0 });
  });
});
