// Two-stage discounted cash flow. Explicit growth for `years`, then a
// Gordon-growth perpetuity. Pure and unit-agnostic: pass FCF in whatever units
// you want the answer in (dollars, millions, per-share). Informational only.

export interface DcfInputs {
  /** Base free cash flow (period 0). Absolute, in the units you want out. */
  fcf0: number;
  /**
   * Annual discount rate, e.g. 0.11 for 11%. Must exceed terminalGrowth.
   * Use COST OF EQUITY when fcf0 is equity/levered FCF (the current caller);
   * WACC only belongs with unlevered/firm-level FCF. Don't conflate the two.
   */
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
  /**
   * PV of the projected FCF stream + terminal value. This is an EQUITY value
   * when fcf0 is equity/levered FCF (the current caller) — a true enterprise
   * value only when fcf0 is unlevered. Named generically; read it by basis.
   */
  enterpriseValue: number;
  /** enterpriseValue + netCash (netCash stays 0 for equity FCF — see netCash). */
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

// --- Bear/Base/Bull scenarios (Phase 4) -------------------------------------
// Assumption-driven value-per-share RANGE, informational only — never a fair
// value or price target. Same basis as the reverse-DCF lens: equity FCF grown at
// a per-scenario rate, discounted at a SHARED cost of equity, compared to market
// cap; netCash stays 0 (no EV bridge).

export type ScenarioLabel = 'bear' | 'base' | 'bull';

/** Shared (company-level) assumptions across all three scenarios. */
export interface SharedAssumptions {
  /** Cost of equity (decimal). Company-level required return — shared, not a scenario knob. */
  costOfEquity: number;
  /** Perpetuity growth (decimal). Must be ≥ TERMINAL_SPREAD below costOfEquity. */
  terminalGrowth: number;
  years: number;
}

export interface ScenarioResult {
  label: ScenarioLabel;
  /** Per-scenario FCF growth (decimal) — the ONLY per-scenario variable. */
  fcfGrowth: number;
  equityValue: number;
  /** equityValue / shares, or null when shares are missing/invalid. */
  perShare: number | null;
}

/** Terminal growth must sit at least this far (100 bps) below cost of equity —
 *  r≈g makes the Gordon terminal value explode, so r>g alone is not enough. */
export const TERMINAL_SPREAD = 0.01;

export const SCENARIO_PRESETS: {
  growths: Record<ScenarioLabel, number>;
  shared: SharedAssumptions;
} = {
  growths: { bear: 0.03, base: 0.08, bull: 0.15 },
  shared: { costOfEquity: 0.11, terminalGrowth: 0.03, years: 10 },
};

/** Valid only when terminal growth is ≥100 bps below cost of equity. */
export function scenarioAssumptionsValid(costOfEquity: number, terminalGrowth: number): boolean {
  return terminalGrowth <= costOfEquity - TERMINAL_SPREAD;
}

/**
 * Compute the three scenarios in fixed bear→base→bull order (never sorted).
 * @throws if the shared assumptions violate the terminal-spread guard — callers
 * validate first and show a warning rather than render a misleading value.
 */
export function computeScenarios(
  fcf0: number,
  growths: Record<ScenarioLabel, number>,
  shared: SharedAssumptions,
  shares: number | null
): ScenarioResult[] {
  if (!scenarioAssumptionsValid(shared.costOfEquity, shared.terminalGrowth)) {
    throw new Error('terminalGrowth must be at least 100bps below costOfEquity');
  }
  const order: ScenarioLabel[] = ['bear', 'base', 'bull'];
  return order.map((label) => {
    const equityValue = intrinsicDcf({
      fcf0,
      growth: growths[label],
      discountRate: shared.costOfEquity,
      terminalGrowth: shared.terminalGrowth,
      years: shared.years,
    }).equityValue;
    const perShare = shares != null && shares > 0 ? equityValue / shares : null;
    return { label, fcfGrowth: growths[label], equityValue, perShare };
  });
}

/** True when the fixed-order results are NOT monotonically non-decreasing by
 *  equity value (user edits can invert bear/base/bull). */
export function isInvertedRange(results: ScenarioResult[]): boolean {
  for (let i = 1; i < results.length; i++) {
    if (results[i].equityValue < results[i - 1].equityValue) return true;
  }
  return false;
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
