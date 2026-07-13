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

// Editable bounds in PERCENT / year units (what the UI holds). Years is a whole
// number. FCF-growth max is 100 to match impliedGrowth's solver range, so the
// scenarios can bracket a high market-implied anchor (e.g. TSLA ~49%).
export const SCENARIO_BOUNDS = {
  fcfGrowth: { min: -20, max: 100 },
  costOfEquity: { min: 5, max: 20 },
  terminalGrowth: { min: 0, max: 6 },
  years: { min: 5, max: 15 },
} as const;

const clampGrowthPct = (v: number) =>
  Math.max(SCENARIO_BOUNDS.fcfGrowth.min, Math.min(SCENARIO_BOUNDS.fcfGrowth.max, v));

/**
 * The reverse-DCF market-implied FCF growth (percent), computed from the SAME
 * effectiveFcf + market cap + shared assumptions the scenario panel uses — the
 * market-consistent reference the scenarios anchor to. Null when it can't be
 * computed (no market cap, non-positive FCF, or invalid assumptions).
 */
export function marketImpliedGrowthPct(
  fcf0: number,
  marketCap: number | null,
  shared: SharedAssumptions
): { pct: number | null; outOfRange: boolean } {
  if (marketCap == null || fcf0 <= 0) return { pct: null, outOfRange: false };
  // Guard years BEFORE impliedGrowth → intrinsicDcf: a cleared Horizon gives
  // years=0 (Number('')), which intrinsicDcf throws on. Fail closed instead.
  if (!Number.isFinite(shared.years) || shared.years < 1) return { pct: null, outOfRange: false };
  if (!scenarioAssumptionsValid(shared.costOfEquity, shared.terminalGrowth)) return { pct: null, outOfRange: false };
  const r = impliedGrowth(
    { fcf0, discountRate: shared.costOfEquity, terminalGrowth: shared.terminalGrowth, years: shared.years },
    marketCap
  );
  return { pct: r.growth * 100, outOfRange: r.outOfRange };
}

/**
 * Seed Bear/Base/Bull FCF growth (percent) AROUND the market-implied anchor:
 * Base = implied, Bear = implied − 10pp, Bull = implied + 10pp, each clamped to
 * bounds. Falls back to a neutral 3/8/15 spread when there's no implied anchor.
 */
export function seedScenarioGrowths(impliedPct: number | null): Record<ScenarioLabel, number> {
  if (impliedPct == null) {
    return { bear: 3, base: 8, bull: 15 }; // no market anchor → neutral spread
  }
  const base = clampGrowthPct(Math.round(impliedPct));
  return { bear: clampGrowthPct(base - 10), base, bull: clampGrowthPct(base + 10) };
}

/**
 * Fail-closed validation of the UI's raw scenario inputs (percent units). Guards
 * non-finite values (blank/partial fields), out-of-range values, a non-integer or
 * out-of-range horizon, and the ≥100 bps terminal spread — so the render path
 * never feeds `computeScenarios`/`intrinsicDcf` a value that would throw.
 */
export function scenarioInputsValid(
  growthsPct: Record<ScenarioLabel, number>,
  costOfEquityPct: number,
  terminalGrowthPct: number,
  years: number
): boolean {
  const nums = [growthsPct.bear, growthsPct.base, growthsPct.bull, costOfEquityPct, terminalGrowthPct, years];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  const within = (v: number, b: { min: number; max: number }) => v >= b.min && v <= b.max;
  return (
    within(growthsPct.bear, SCENARIO_BOUNDS.fcfGrowth) &&
    within(growthsPct.base, SCENARIO_BOUNDS.fcfGrowth) &&
    within(growthsPct.bull, SCENARIO_BOUNDS.fcfGrowth) &&
    within(costOfEquityPct, SCENARIO_BOUNDS.costOfEquity) &&
    within(terminalGrowthPct, SCENARIO_BOUNDS.terminalGrowth) &&
    Number.isInteger(years) && within(years, SCENARIO_BOUNDS.years) &&
    terminalGrowthPct <= costOfEquityPct - 1 // ≥100 bps below CoE (percent units)
  );
}

/**
 * Compute the three scenarios in fixed bear→base→bull order (never sorted).
 *
 * Callers must pre-validate raw UI inputs with `scenarioInputsValid` first — this
 * function only re-checks the terminal spread, NOT ranges, finiteness, or the
 * horizon (a `years < 1` reaches `intrinsicDcf` and throws).
 *
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

// --- Terminal-value disclosure + two-way sensitivity (P3-A) -----------------
// Deterministic transparency about where the DCF's value comes from and how
// fragile it is to the two assumptions users tune least: cost of equity and
// terminal growth. No probabilities, no verdicts.

/** Above this share of present value coming from the terminal stub, the output
 *  is mostly perpetuity assumption, not the explicit forecast — worth a warning. */
export const TERMINAL_DOMINANCE_THRESHOLD = 0.75;

export interface TerminalContribution {
  /** pvTerminal / (pvExplicit + pvTerminal), 0..1. */
  fraction: number;
  dominant: boolean;
}

export function terminalContribution(r: Pick<DcfResult, 'pvExplicit' | 'pvTerminal'>): TerminalContribution {
  const total = r.pvExplicit + r.pvTerminal;
  const fraction = total > 0 ? r.pvTerminal / total : 0;
  return { fraction, dominant: fraction >= TERMINAL_DOMINANCE_THRESHOLD };
}

export interface SensitivityGrid {
  /** Column headers: cost of equity, percent. */
  coePcts: number[];
  /** Row headers: terminal growth, percent. */
  terminalPcts: number[];
  /** values[terminalIdx][coeIdx] = equity value; null where the pair violates
   *  the ≥100 bps terminal spread (Gordon growth would explode). */
  values: (number | null)[][];
  /** Index of the caller's current assumptions within the headers. */
  center: { coeIdx: number; terminalIdx: number };
}

const uniqueSteps = (center: number, offsets: number[], min: number, max: number): number[] =>
  [...new Set(offsets.map((o) => Math.min(max, Math.max(min, center + o))))];

/**
 * Two-way sensitivity of the DCF equity value to cost of equity (±2 pp) and
 * terminal growth (±1 pp), holding the FCF base, growth path, and horizon
 * fixed. Steps are clamped to the editable bounds and deduplicated.
 */
export function sensitivityGrid(
  fcf0: number,
  growth: number,
  years: number,
  coePct: number,
  terminalPct: number
): SensitivityGrid {
  const coePcts = uniqueSteps(coePct, [-2, -1, 0, 1, 2], SCENARIO_BOUNDS.costOfEquity.min, SCENARIO_BOUNDS.costOfEquity.max);
  const terminalPcts = uniqueSteps(terminalPct, [-1, -0.5, 0, 0.5, 1], SCENARIO_BOUNDS.terminalGrowth.min, SCENARIO_BOUNDS.terminalGrowth.max);
  const values = terminalPcts.map((tg) =>
    coePcts.map((coe) =>
      tg <= coe - 1
        ? intrinsicDcf({ fcf0, growth, discountRate: coe / 100, terminalGrowth: tg / 100, years }).equityValue
        : null
    )
  );
  return {
    coePcts,
    terminalPcts,
    values,
    center: { coeIdx: coePcts.indexOf(coePct), terminalIdx: terminalPcts.indexOf(terminalPct) }
  };
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
