import { marketImpliedGrowthPct, type SharedAssumptions } from './dcf';
import type { Drivers } from './valuation';

// "What must be true?" — compares what the price IMPLIES (reverse DCF) against
// what the business has recently DELIVERED, with a discount-rate sensitivity band
// so the implied figure never reads as precise. Deterministic, formula-based, no
// verdict. Financials are gated upstream (this only renders for non-financials).

/** Implied FCF growth this far above trailing revenue growth (pp) triggers the gap note. */
export const EXPECTATION_GAP_PP = 15;
/** Discount-rate sensitivity band width (±pp) around the reference cost of equity. */
export const EXPECTATION_BAND_PP = 2;

export interface MarketExpectations {
  /** Reference cost of equity used (percent), and the band it was swept over. */
  discountRefPct: number;
  discountLowPct: number;
  discountHighPct: number;
  /** Implied FCF growth (%) at the reference discount; clamped values flag outOfRange. */
  impliedPct: number | null;
  impliedOutOfRange: boolean;
  /** Implied FCF growth at discount −band / +band (monotonic: low ≤ ref ≤ high). */
  bandLowPct: number | null;
  bandHighPct: number | null;
  bandOutOfRange: boolean;
  delivered: {
    revenueGrowthTTM: number | null;
    revenueCagr: number | null;
    fcfMargin: number | null;
    operatingMargin: number | null;
    capexIntensity: number | null;
    shareCountChange: number | null;
  };
  /** True when implied growth is far above (or beyond the range of) recent revenue growth. */
  gap: boolean;
}

export function buildMarketExpectations(args: {
  effectiveFcf: number;
  marketCap: number | null;
  shared: SharedAssumptions;
  drivers: Drivers | null;
  revenueGrowthTTM: number | null;
}): MarketExpectations {
  const { effectiveFcf, marketCap, shared, drivers, revenueGrowthTTM } = args;
  const band = EXPECTATION_BAND_PP / 100;

  const center = marketImpliedGrowthPct(effectiveFcf, marketCap, shared);
  const lo = marketImpliedGrowthPct(effectiveFcf, marketCap, { ...shared, costOfEquity: shared.costOfEquity - band });
  const hi = marketImpliedGrowthPct(effectiveFcf, marketCap, { ...shared, costOfEquity: shared.costOfEquity + band });

  const gap =
    center.outOfRange ||
    (center.pct != null && revenueGrowthTTM != null && center.pct - revenueGrowthTTM > EXPECTATION_GAP_PP);

  return {
    discountRefPct: shared.costOfEquity * 100,
    discountLowPct: (shared.costOfEquity - band) * 100,
    discountHighPct: (shared.costOfEquity + band) * 100,
    impliedPct: center.pct,
    impliedOutOfRange: center.outOfRange,
    bandLowPct: lo.pct,   // lower discount → lower implied growth
    bandHighPct: hi.pct,  // higher discount → higher implied growth
    bandOutOfRange: lo.outOfRange || hi.outOfRange,
    delivered: {
      revenueGrowthTTM,
      revenueCagr: drivers?.revenueCagr ?? null,
      fcfMargin: drivers?.fcfMargin ?? null,
      operatingMargin: drivers?.operatingMargin ?? null,
      capexIntensity: drivers?.capexIntensity ?? null,
      shareCountChange: drivers?.shareCountChange ?? null,
    },
    gap,
  };
}
