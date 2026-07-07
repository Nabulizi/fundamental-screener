// Two-stage discounted cash flow. Explicit growth for `years`, then a
// Gordon-growth perpetuity. Pure and unit-agnostic: pass FCF in whatever units
// you want the answer in (dollars, millions, per-share). Informational only.

export interface DcfInputs {
  /** Base free cash flow (period 0). Absolute, in the units you want out. */
  fcf0: number;
  /** Annual discount rate (WACC), e.g. 0.11 for 11%. Must exceed terminalGrowth. */
  discountRate: number;
  /** FCF growth during the explicit horizon, e.g. 0.10 for 10%. */
  growth: number;
  /** Perpetuity growth after the horizon, e.g. 0.03. Must be < discountRate. */
  terminalGrowth: number;
  /** Explicit horizon in years. Default 10. */
  years?: number;
  /**
   * Net cash (cash − debt) bridging enterprise value → equity value. Default 0.
   * ONLY valid when `fcf0` is UNLEVERED (firm-level) FCF discounted at WACC.
   * If `fcf0` is equity/levered FCF (e.g. derived from Price/FCF, already net of
   * capital structure via market cap), leave this at 0 — adding it double-counts
   * net cash into the value. Callers today pass equity FCF, so netCash stays 0.
   */
  netCash?: number;
}

export interface DcfResult {
  pvExplicit: number;
  pvTerminal: number;
  terminalValue: number;
  /** PV of explicit FCF + PV of terminal value. */
  enterpriseValue: number;
  /** enterpriseValue + netCash. */
  equityValue: number;
}

/**
 * Reverse DCF: the constant FCF growth rate that makes the DCF's equity value
 * equal `targetValue` (today's market cap) — i.e. "what growth is priced in?".
 * A market-implied assumption, NOT a target or recommendation.
 *
 * Equity value is monotincreasing in growth, so this bisects. Returns the growth
 * (decimal) plus `outOfRange` when the target lies outside what -50%…+100% growth
 * can produce (returns the nearest bound in that case).
 *
 * `fcf0` must be equity/levered FCF and `netCash` left at 0 — see intrinsicDcf.
 */
export function impliedGrowth(
  base: Omit<DcfInputs, 'growth'>,
  targetValue: number
): { growth: number; outOfRange: boolean } {
  const LO = -0.5;
  const HI = 1.0;
  const value = (g: number) => intrinsicDcf({ ...base, growth: g }).equityValue;
  if (targetValue <= value(LO)) return { growth: LO, outOfRange: true };
  if (targetValue >= value(HI)) return { growth: HI, outOfRange: true };

  let lo = LO;
  let hi = HI;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (value(mid) < targetValue) lo = mid;
    else hi = mid;
  }
  return { growth: (lo + hi) / 2, outOfRange: false };
}

/**
 * @throws if discountRate <= terminalGrowth (Gordon growth diverges) or years < 1.
 */
export function intrinsicDcf(i: DcfInputs): DcfResult {
  const years = i.years ?? 10;
  const netCash = i.netCash ?? 0;
  if (i.discountRate <= i.terminalGrowth) {
    throw new Error('discountRate must be greater than terminalGrowth');
  }
  if (years < 1) throw new Error('years must be >= 1');

  let pvExplicit = 0;
  let fcf = i.fcf0;
  for (let t = 1; t <= years; t++) {
    fcf *= 1 + i.growth;
    pvExplicit += fcf / (1 + i.discountRate) ** t;
  }
  // Terminal value on the final explicit-year FCF, discounted back from year N.
  const terminalValue = (fcf * (1 + i.terminalGrowth)) / (i.discountRate - i.terminalGrowth);
  const pvTerminal = terminalValue / (1 + i.discountRate) ** years;

  const enterpriseValue = pvExplicit + pvTerminal;
  return {
    pvExplicit,
    pvTerminal,
    terminalValue,
    enterpriseValue,
    equityValue: enterpriseValue + netCash
  };
}
