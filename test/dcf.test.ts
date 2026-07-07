import { describe, it, expect } from 'vitest';
import { intrinsicDcf, impliedGrowth } from '@/lib/dcf';

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
