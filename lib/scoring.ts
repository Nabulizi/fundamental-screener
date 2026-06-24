import type { ScanRow } from './types';
import { clampFraction } from './range';
import { formatPercent, formatReturn, formatPe, formatRatio } from './format';

// ---------------------------------------------------------------------------
// Master Scoring Framework (v2) — 10 criteria, weighted by significance tier,
// split into two independent scores instead of one signed total.
//
//   Tier 1 (×3) — Survival & Quality:  Earnings Quality, Leverage
//   Tier 2 (×2) — Fundamental Strength: Revenue Growth, FCF Yield, P/E Compression
//   Tier 3 (×1) — Valuation / Timing:   EV/EBITDA, Dividend Coverage,
//                                        52W Position, YTD, Dividend Yield
//
// Each raw signal is +1 / 0 / −1, then multiplied by its tier weight.
//   • Strength Score = sum of the POSITIVE weighted signals  (0 … +17)
//   • Risk Score     = sum of the |NEGATIVE| weighted signals (0 … 16)
// They are reported separately: "how good is the opportunity?" and "how
// dangerous is the stock?" are different questions and a single net number
// conflates them.
//
// Refinements over v1:
//   • Leverage (D/E) is neutralized when book equity is negative (buyback-
//     distorted D/E is noise) or the company is a financial (leverage is
//     structural), instead of mechanically flagging it as dangerous.
//   • P/E compression is neutralized for cyclicals (semis, autos): a low
//     forward P/E off peak earnings is a trap, not a positive signal.
//   • A "crowding" flag (mega-cap trading near its 52-week high) caps a stock
//     at "moderate" — a $200B+ name everyone already owns is a reason for
//     suspicion, not top billing.
//
// Hard floors (force tier to "weak" regardless of strength):
//   • −1 on Earnings Quality or Leverage (a Tier 1 elimination), or
//   • Risk Score ≥ 8 (too many red flags to rescue).
// ---------------------------------------------------------------------------

/** Raw signal before weighting. */
export interface ScoreBreakdown {
  /** #1 — Earnings quality: FCF Yield vs Earnings Yield. ×3 */
  earningsQuality: -1 | 0 | 1;
  /** #2 — Leverage: D/E assessment (neutralized for negative equity / financials). ×3 */
  leverage: -1 | 0 | 1;
  /** #3 — Revenue growth > 10%. ×2 */
  revenueGrowth: -1 | 0 | 1;
  /** #4 — FCF Yield > 5%. ×2 */
  fcfYieldLevel: -1 | 0 | 1;
  /** #5 — P/E compression: FWD < TTM (neutralized for cyclicals). ×2 */
  peCompression: -1 | 0 | 1;
  /** #6 — Valuation: EV/EBITDA. ×1 */
  valuation: -1 | 0 | 1;
  /** #7 — Dividend covered by FCF. ×1 */
  dividendCoverage: -1 | 0 | 1;
  /** #8 — 52W position < 40%. ×1 */
  pricePosition: -1 | 0 | 1;
  /** #9 — YTD momentum. ×1 */
  ytdMomentum: -1 | 0 | 1;
  /** #10 — Dividend yield > 1.5%. ×1 (never negative) */
  dividendYield: -1 | 0 | 1;
}

/** Neutral, non-advisory signal-strength label. */
export type SignalTier = 'strong' | 'moderate' | 'weak';

/** Overlay conditions that adjust the tier without being scored criteria. */
export interface RowFlags {
  /** Tier 1 elimination: Earnings Quality or Leverage scored −1. */
  disqualified: boolean;
  /** Cyclical industry (semis, autos) — P/E compression was neutralized. */
  cyclical: boolean;
  /** Mega-cap trading near its 52-week high — already-discovered, caps at moderate. */
  crowding: boolean;
}

export interface ScoredRow {
  row: ScanRow;
  breakdown: ScoreBreakdown;
  /** Sum of positive weighted signals. 0 … +17. */
  strengthScore: number;
  /** Sum of |negative| weighted signals. 0 … 16. */
  riskScore: number;
  flags: RowFlags;
  tier: SignalTier;
}

/** Strength score when every criterion is +1. */
export const MAX_STRENGTH = 17;
/** Risk score when every (negatable) criterion is −1. */
export const MAX_RISK = 16;
/** Risk score at/above which a stock is forced to "weak" regardless of strength. */
export const RISK_FLOOR = 8;

/** Mega-cap cutoff (raw currency units) for the crowding overlay. */
export const MEGA_CAP_THRESHOLD = 200_000_000_000;

/**
 * D/E above this is treated as distorted (a near-zero equity base from years of
 * buybacks blows the ratio up), so it's neutralized rather than flagged as
 * dangerous — same rationale as negative book equity. EV/EBITDA carries the
 * real leverage read in these cases. A genuinely over-leveraged company sits in
 * the 2–10 band and still scores −1.
 */
export const EXTREME_DE_RATIO = 10;

/** Tier weight for each criterion, ordered by significance. */
export const CRITERION_WEIGHT: Record<keyof ScoreBreakdown, number> = {
  earningsQuality: 3,
  leverage: 3,
  revenueGrowth: 2,
  fcfYieldLevel: 2,
  peCompression: 2,
  valuation: 1,
  dividendCoverage: 1,
  pricePosition: 1,
  ytdMomentum: 1,
  dividendYield: 1,
};

/** Human-readable labels, ordered by significance rank. */
export const CRITERION_LABELS: Record<keyof ScoreBreakdown, string> = {
  earningsQuality: 'Earnings Quality',
  leverage: 'Leverage (D/E)',
  revenueGrowth: 'Revenue Growth',
  fcfYieldLevel: 'FCF Yield Level',
  peCompression: 'P/E Compression',
  valuation: 'Valuation (EV/EBITDA)',
  dividendCoverage: 'Dividend Coverage',
  pricePosition: '52W Position',
  ytdMomentum: 'YTD Momentum',
  dividendYield: 'Dividend Yield',
};

/** Ordered keys by rank for consistent iteration. */
export const CRITERION_KEYS: (keyof ScoreBreakdown)[] = [
  'earningsQuality',
  'leverage',
  'revenueGrowth',
  'fcfYieldLevel',
  'peCompression',
  'valuation',
  'dividendCoverage',
  'pricePosition',
  'ytdMomentum',
  'dividendYield',
];

// Industries where a low forward P/E reflects cyclical peak earnings rather
// than durable growth — compression is neutralized for these.
const CYCLICAL_PATTERNS = [/semiconductor/i, /automobile/i, /\bautos?\b/i];

// Industries where leverage is a structural part of the business model, so a
// high D/E is not a danger signal on its own.
const FINANCIAL_PATTERNS = [/financ/i, /\bbank/i, /insurance/i, /capital markets/i];

export function isCyclicalIndustry(industry: string | null | undefined): boolean {
  return industry != null && CYCLICAL_PATTERNS.some((re) => re.test(industry));
}

export function isFinancialIndustry(industry: string | null | undefined): boolean {
  return industry != null && FINANCIAL_PATTERNS.some((re) => re.test(industry));
}

function n(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function computeBreakdown(row: ScanRow): ScoreBreakdown {
  const pe = n(row.trailingPE);
  const fwdPe = n(row.forwardPE);
  const fcf = n(row.fcfYieldPercent);
  const revGrowth = n(row.revenueGrowthTTM);
  const de = n(row.debtToEquity);
  const evEbitda = n(row.evToEbitda);
  const divYield = n(row.dividendYieldPercent);
  const ytd = n(row.ytdReturn);
  const rangePos = n(row.rangePosition != null ? clampFraction(row.rangePosition) : null);

  // #1 — Earnings quality: compare FCF Yield to Earnings Yield (100/PE)
  let earningsQuality: -1 | 0 | 1 = 0;
  if (fcf != null && pe != null && pe > 0) {
    const earningsYield = 100 / pe;
    const diff = fcf - earningsYield;
    earningsQuality = diff > 1 ? 1 : diff < -1 ? -1 : 0;
  } else if (fcf != null && fcf < 0) {
    earningsQuality = -1;
  }

  // #2 — Leverage: D/E < 1.0 → +1, > 2.0 → −1.
  // Neutralized (0) when the ratio is distorted — negative book equity or an
  // extreme positive value (both from buybacks shrinking the equity base) — or
  // when the company is a financial (leverage is structural). Trust EV/EBITDA
  // for those instead.
  let leverage: -1 | 0 | 1 = 0;
  if (de != null && de >= 0 && de <= EXTREME_DE_RATIO && !isFinancialIndustry(row.industry)) {
    leverage = de < 1.0 ? 1 : de > 2.0 ? -1 : 0;
  }

  // #3 — Revenue growth: > 10% → +1, < 0% → −1
  const revenueGrowth: -1 | 0 | 1 =
    revGrowth != null ? (revGrowth > 10 ? 1 : revGrowth < 0 ? -1 : 0) : 0;

  // #4 — FCF Yield level: > 5% → +1, < 2% → −1
  const fcfYieldLevel: -1 | 0 | 1 =
    fcf != null ? (fcf > 5 ? 1 : fcf < 2 ? -1 : 0) : 0;

  // #5 — P/E Compression: FWD < TTM → +1. Neutralized for cyclicals, where a
  // low forward P/E signals peak earnings (a trap), not durable growth.
  let peCompression: -1 | 0 | 1 = 0;
  if (pe != null && fwdPe != null && !isCyclicalIndustry(row.industry)) {
    peCompression = fwdPe < pe ? 1 : fwdPe > pe ? -1 : 0;
  }

  // #6 — Valuation: EV/EBITDA < 15 → +1, > 25 → −1
  const valuation: -1 | 0 | 1 =
    evEbitda != null ? (evEbitda < 15 ? 1 : evEbitda > 25 ? -1 : 0) : 0;

  // #7 — Dividend coverage: FCF > Div Yield → +1, FCF < Div Yield → −1
  let dividendCoverage: -1 | 0 | 1 = 0;
  if (divYield != null && divYield > 0) {
    if (fcf != null) {
      dividendCoverage = fcf > divYield ? 1 : -1;
    }
  }

  // #8 — 52W Position: < 0.4 → +1 (potential value), > 0.9 → −1 (extended)
  const pricePosition: -1 | 0 | 1 =
    rangePos != null ? (rangePos < 0.4 ? 1 : rangePos > 0.9 ? -1 : 0) : 0;

  // #9 — YTD momentum: positive → +1, negative → −1
  const ytdMomentum: -1 | 0 | 1 =
    ytd != null ? (ytd > 0 ? 1 : ytd < 0 ? -1 : 0) : 0;

  // #10 — Dividend yield: > 1.5% → +1, 0 or null → 0 (non-payer, neutral)
  const dividendYield: -1 | 0 | 1 =
    divYield != null && divYield > 0 ? (divYield > 1.5 ? 1 : 0) : 0;

  return {
    earningsQuality,
    leverage,
    revenueGrowth,
    fcfYieldLevel,
    peCompression,
    valuation,
    dividendCoverage,
    pricePosition,
    ytdMomentum,
    dividendYield,
  };
}

/** Split the weighted breakdown into separate strength and risk totals. */
export function computeScores(breakdown: ScoreBreakdown): { strength: number; risk: number } {
  let strength = 0;
  let risk = 0;
  for (const k of CRITERION_KEYS) {
    const weighted = breakdown[k] * CRITERION_WEIGHT[k];
    if (weighted > 0) strength += weighted;
    else if (weighted < 0) risk += -weighted;
  }
  return { strength, risk };
}

/**
 * Net weighted total (strength − risk). Retained as a convenience for callers
 * that want a single comparable number; the UI uses the split scores.
 */
export function totalScore(breakdown: ScoreBreakdown): number {
  const { strength, risk } = computeScores(breakdown);
  return strength - risk;
}

/**
 * True when a Tier 1 criterion (Earnings Quality or Leverage) scores −1. This
 * is a hard disqualifier — the stock cannot be "strong" or "moderate".
 */
export function isDisqualified(breakdown: ScoreBreakdown): boolean {
  return breakdown.earningsQuality === -1 || breakdown.leverage === -1;
}

/** Mega-cap trading in the top 10% of its 52-week range. */
export function isCrowded(row: ScanRow): boolean {
  const cap = n(row.marketCap);
  const pos = row.rangePosition != null ? clampFraction(row.rangePosition) : null;
  return cap != null && cap >= MEGA_CAP_THRESHOLD && pos != null && pos > 0.9;
}

/**
 * Map split scores + overlay flags to a neutral signal tier.
 * Hard floor: disqualified or risk ≥ RISK_FLOOR → "weak" regardless of strength.
 * Crowding caps a stock at "moderate".
 */
export function tierFor(strengthScore: number, riskScore: number, flags: RowFlags): SignalTier {
  if (flags.disqualified || riskScore >= RISK_FLOOR) return 'weak';
  if (strengthScore >= 12) return flags.crowding ? 'moderate' : 'strong';
  if (strengthScore >= 7) return 'moderate';
  return 'weak';
}

export function scoreRow(row: ScanRow): ScoredRow {
  const breakdown = computeBreakdown(row);
  const { strength, risk } = computeScores(breakdown);
  const flags: RowFlags = {
    disqualified: isDisqualified(breakdown),
    cyclical: isCyclicalIndustry(row.industry),
    crowding: isCrowded(row),
  };
  return {
    row,
    breakdown,
    strengthScore: strength,
    riskScore: risk,
    flags,
    tier: tierFor(strength, risk, flags),
  };
}

/** Weighted score for a single criterion (for display). */
export function weightedValue(key: keyof ScoreBreakdown, raw: -1 | 0 | 1): number {
  return raw * CRITERION_WEIGHT[key];
}

export function breakdownTooltip(breakdown: ScoreBreakdown): string {
  return CRITERION_KEYS
    .map((k) => {
      const raw = breakdown[k];
      const w = CRITERION_WEIGHT[k];
      const weighted = raw * w;
      const sign = weighted > 0 ? `+${weighted}` : weighted < 0 ? `${weighted}` : ' 0';
      return `${CRITERION_LABELS[k]} (×${w}): ${sign}`;
    })
    .join('\n');
}

/**
 * Short human-readable "evidence" string for a criterion — the actual figures
 * that produced its score, so the breakdown is self-explanatory. Mirrors the
 * data reads in computeBreakdown. Returns "no data" / "no dividend" when the
 * inputs are unavailable (the criterion scores 0 in those cases).
 */
export function criterionEvidence(row: ScanRow, key: keyof ScoreBreakdown): string {
  const pe = n(row.trailingPE);
  const fwdPe = n(row.forwardPE);
  const fcf = n(row.fcfYieldPercent);
  const rev = n(row.revenueGrowthTTM);
  const de = n(row.debtToEquity);
  const ev = n(row.evToEbitda);
  const div = n(row.dividendYieldPercent);
  const ytd = n(row.ytdReturn);
  const pos = row.rangePosition != null ? clampFraction(row.rangePosition) : null;

  switch (key) {
    case 'earningsQuality':
      if (fcf != null && pe != null && pe > 0) return `FCF ${formatPercent(fcf)} vs EY ${formatPercent(100 / pe)}`;
      if (fcf != null && fcf < 0) return `FCF ${formatPercent(fcf)} (negative)`;
      return 'no data';
    case 'leverage':
      if (de == null) return 'no data';
      if (isFinancialIndustry(row.industry)) return `D/E ${formatRatio(de)} · financial — neutralized`;
      if (de < 0) return `D/E ${formatRatio(de)} · neg. equity — neutralized`;
      if (de > EXTREME_DE_RATIO) return `D/E ${formatRatio(de)} · buyback-distorted — neutralized`;
      return `D/E ${formatRatio(de)}`;
    case 'revenueGrowth':
      return rev != null ? `${formatReturn(rev)} YoY` : 'no data';
    case 'fcfYieldLevel':
      return fcf != null ? formatPercent(fcf) : 'no data';
    case 'peCompression':
      if (pe == null || fwdPe == null) return 'no data';
      return isCyclicalIndustry(row.industry)
        ? `Fwd ${formatPe(fwdPe)} vs TTM ${formatPe(pe)} · cyclical — neutralized`
        : `Fwd ${formatPe(fwdPe)} vs TTM ${formatPe(pe)}`;
    case 'valuation':
      return ev != null ? `EV/EBITDA ${formatRatio(ev)}` : 'no data';
    case 'dividendCoverage':
      if (div == null || div <= 0) return 'no dividend';
      if (fcf == null) return `Div ${formatPercent(div)} · FCF n/a`;
      return `FCF ${formatPercent(fcf)} vs Div ${formatPercent(div)}`;
    case 'pricePosition':
      return pos != null ? `${Math.round(pos * 100)}% of range` : 'no data';
    case 'ytdMomentum':
      return ytd != null ? `${formatReturn(ytd)} YTD` : 'no data';
    case 'dividendYield':
      return div != null && div > 0 ? formatPercent(div) : 'no dividend';
  }
}

/**
 * Threshold reference per criterion (what earns +1 vs −1), for the benchmark
 * table in the methodology panel. Kept here so the displayed benchmarks stay in
 * lockstep with the logic in computeBreakdown.
 */
export const CRITERION_BENCHMARK: Record<keyof ScoreBreakdown, { positive: string; negative: string }> = {
  earningsQuality: { positive: 'FCF Yield > Earnings Yield by 1pp+', negative: 'FCF below EY by 1pp+, or FCF < 0' },
  leverage: { positive: 'D/E < 1.0', negative: 'D/E 2.0–10 (neutral: financials, neg./>10 equity)' },
  revenueGrowth: { positive: '> 10% YoY', negative: '< 0% (declining)' },
  fcfYieldLevel: { positive: '> 5%', negative: '< 2%' },
  peCompression: { positive: 'Fwd < TTM (neutral: cyclicals)', negative: 'Fwd > TTM' },
  valuation: { positive: 'EV/EBITDA < 15', negative: '> 25' },
  dividendCoverage: { positive: 'FCF Yield > Dividend Yield', negative: 'FCF < Dividend (non-payers: 0)' },
  pricePosition: { positive: '< 40% of 52W range', negative: '> 90% of range' },
  ytdMomentum: { positive: 'positive YTD', negative: 'negative YTD' },
  dividendYield: { positive: '> 1.5% (non-payers: 0)', negative: '—' },
};
