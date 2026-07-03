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
  /** Tier 1 elimination: Earnings Quality or Leverage scored −1 (and not waived). */
  disqualified: boolean;
  /** Cyclical industry (semis, autos) — P/E compression was neutralized. */
  cyclical: boolean;
  /** Mega-cap trading near its 52-week high — already-discovered, caps at moderate. */
  crowding: boolean;
  /**
   * Earnings Quality scored −1 but it's a growth/capex drag (strong positive FCF
   * + surging revenue), so it was waived from the hard-floor disqualifier. It
   * still costs Risk points.
   */
  benignEarningsQuality: boolean;
  /**
   * The provider's revenue-growth figure was implausible (beyond the sanity
   * bounds) — neutralized rather than scored. Verify at the source.
   */
  suspectRevenueGrowth: boolean;
  /**
   * Too little data to trust a tier: criterion coverage below
   * MIN_CRITERION_COVERAGE, or a risk-critical input (FCF, D/E) is missing
   * where applicable. A null input can never score −1, so sparse rows would
   * otherwise look SAFER than covered ones. Forces the tier to weak.
   */
  insufficientData: boolean;
  /**
   * Optically cheap AND revenue shrinking — the cheapness likely prices the
   * decline. Caps the tier at moderate.
   */
  valueTrap: boolean;
  /**
   * Cyclical, optically cheap on trailing numbers, with forward estimates
   * rolling over — the top-of-cycle signature. Caps the tier at moderate.
   */
  peakCycle: boolean;
}

/** How much of the scorecard actually had data behind it. */
export interface CriterionCoverage {
  /** Applicable criteria whose inputs were present. */
  covered: number;
  /** Criteria that apply to this row (deliberately-neutralized ones excluded). */
  applicable: number;
  /** covered / applicable (0 when nothing is applicable). */
  fraction: number;
}

export interface ScoredRow {
  row: ScanRow;
  breakdown: ScoreBreakdown;
  /** Sum of positive weighted signals. 0 … +17. */
  strengthScore: number;
  /** Sum of |negative| weighted signals. 0 … 16. */
  riskScore: number;
  coverage: CriterionCoverage;
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
 * D/E above this (or negative) is treated as distorted — a near-zero or negative
 * equity base blows the ratio up. But distortion has two very different causes:
 * buybacks shrinking the equity of a healthy cash generator (MCD — benign) and
 * accumulated losses wiping out the equity of a struggling one (fatal). Interest
 * coverage arbitrates: below WEAK_INTEREST_COVERAGE the debt is a live threat
 * and scores −1 (a Tier 1 elimination); otherwise the distorted ratio is
 * neutralized. With no coverage data the criterion stays neutral (we can't
 * arbitrate). A genuinely over-leveraged company in the 2–10 band still scores
 * −1 directly.
 */
export const EXTREME_DE_RATIO = 10;
/** Interest coverage below this marks a distorted-D/E balance sheet as fatal. */
export const WEAK_INTEREST_COVERAGE = 2;

/**
 * Sanity bounds on provider revenue growth. Values beyond these are treated as
 * data artifacts — neutralized (0) and flagged, never scored or used for the
 * benign-EQ waiver. Verified live: Finnhub returned revenueGrowthTTMYoy 108.98
 * for JPM. Financials get a tighter bound (their "revenue" definition shifts
 * with rates/trading mix); genuine non-financial hyper-growth (e.g. memory-cycle
 * 150%) stays scored under the general bound.
 */
export const SUSPECT_REV_GROWTH_FINANCIAL = 60;
export const SUSPECT_REV_GROWTH_GENERAL = 300;

/**
 * Revenue growth after the sanity bounds: `value` is null when the raw figure
 * is implausible (with `suspect: true`) so downstream reads treat it exactly
 * like missing data.
 */
export function sanitizeRevenueGrowth(row: ScanRow): { value: number | null; suspect: boolean } {
  const raw = row.revenueGrowthTTM != null && Number.isFinite(row.revenueGrowthTTM) ? row.revenueGrowthTTM : null;
  if (raw == null) return { value: null, suspect: false };
  const bound = isFinancialIndustry(row.industry) ? SUSPECT_REV_GROWTH_FINANCIAL : SUSPECT_REV_GROWTH_GENERAL;
  return raw > bound ? { value: null, suspect: true } : { value: raw, suspect: false };
}

/**
 * Earnings Quality is judged on the FCF→net-income CONVERSION RATIO
 * (fcfYield × PE / 100 — the price terms cancel exactly), not on an absolute
 * gap between the two yields. An absolute-pp gap is valuation-dependent: 1pp at
 * P/E 8 is an 8% earnings shortfall, while 1pp at P/E 50 is a 50% shortfall —
 * which disqualified cheap stocks and waved through expensive low-converters.
 */
export const EQ_CONVERSION_STRONG = 1.0; // FCF/NI above this → +1
export const EQ_CONVERSION_WEAK = 0.7;   // FCF/NI below this → −1

/**
 * A −1 Earnings Quality is treated as a benign growth/capex drag — not a cash-
 * conversion red flag — when FCF is still at least neutral-grade AND revenue is
 * surging. Fast growth mechanically inflates receivables and justifies heavy
 * capex, so FCF legitimately trails (the larger) reported earnings. Such a −1
 * still costs Risk points but is waived from the hard-floor disqualifier.
 */
export const BENIGN_EQ_MIN_FCF_YIELD = 2;    // FCF yield must be ≥ this (not weak/negative)
export const BENIGN_EQ_MIN_REV_GROWTH = 20;  // revenue growth must exceed this (hyper-growth)

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

// Industries where trailing earnings swing with the cycle, so a low TTM
// multiple can mean peak earnings rather than a bargain. Compression is
// treated asymmetrically for these (expected EPS growth is never rewarded;
// expected decline keeps its −1) and the peak-cycle gate applies. Deliberately
// pattern-based on Finnhub's industry labels; deepen to GICS sectors when a
// sector source is added.
const CYCLICAL_PATTERNS = [
  /semiconductor/i,
  /automobile/i, /\bautos?\b/i, /auto components/i,
  /\boil\b/i, /\bgas\b/i, /\bcoal\b/i, /petroleum/i, /drilling/i, /energy equipment/i, /consumable fuels/i,
  /mining/i, /metals/i, /\bsteel\b/i, /aluminum/i,
  /chemical/i,
  /\bmarine\b/i, /shipping/i,
  /airline/i,
  /construction/i, /building/i, /homebuild/i,
  /paper/i, /forest/i,
];

// Industries where leverage is a structural part of the business model, so a
// high D/E is not a danger signal on its own. For financials the FCF-derived
// criteria (earnings quality, FCF level, dividend coverage) and EV/EBITDA are
// ALSO neutralized: P/FCF and EBITDA are economically meaningless for banks and
// insurers, and providers feed noise for them (verified live: Finnhub returns
// a P/FCF of ~6 for JPM, i.e. a 16.7% "FCF yield").
const FINANCIAL_PATTERNS = [/financ/i, /\bbank/i, /insurance/i, /capital markets/i];

// REITs carry structurally higher leverage (property-backed debt), so D/E is
// neutralized for them too — but their FCF, while capex-heavy, is still a real
// economic quantity, so FCF-derived criteria stay scored.
const REIT_PATTERNS = [/\breits?\b/i, /real estate/i];

export function isCyclicalIndustry(industry: string | null | undefined): boolean {
  return industry != null && CYCLICAL_PATTERNS.some((re) => re.test(industry));
}

export function isFinancialIndustry(industry: string | null | undefined): boolean {
  return industry != null && FINANCIAL_PATTERNS.some((re) => re.test(industry));
}

export function isReitIndustry(industry: string | null | undefined): boolean {
  return industry != null && REIT_PATTERNS.some((re) => re.test(industry));
}

function n(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function computeBreakdown(row: ScanRow): ScoreBreakdown {
  const pe = n(row.trailingPE);
  const fwdPe = n(row.forwardPE);
  const fcf = n(row.fcfYieldPercent);
  const revGrowth = sanitizeRevenueGrowth(row).value;
  const de = n(row.debtToEquity);
  const evEbitda = n(row.evToEbitda);
  const divYield = n(row.dividendYieldPercent);
  const ytd = n(row.ytdReturn);
  const rangePos = n(row.rangePosition != null ? clampFraction(row.rangePosition) : null);

  const financial = isFinancialIndustry(row.industry);

  // #1 — Earnings quality: FCF/NI conversion ratio (fcfYield × PE / 100).
  // Valuation-neutral: the same ratio threshold applies at every multiple.
  // Neutralized for financials (P/FCF-derived FCF yield is noise for them).
  let earningsQuality: -1 | 0 | 1 = 0;
  if (!financial) {
    if (fcf != null && fcf < 0) {
      earningsQuality = -1;
    } else if (fcf != null && pe != null && pe > 0) {
      const conversion = (fcf * pe) / 100;
      earningsQuality = conversion > EQ_CONVERSION_STRONG ? 1 : conversion < EQ_CONVERSION_WEAK ? -1 : 0;
    }
  }

  // #2 — Leverage: D/E < 1.0 → +1, > 2.0 → −1.
  // Financials and REITs: neutralized (leverage is structural). Distorted
  // ratios (negative or > EXTREME_DE_RATIO): interest coverage arbitrates —
  // weak coverage means the debt is a live threat (−1); otherwise neutral.
  let leverage: -1 | 0 | 1 = 0;
  if (de != null && !financial && !isReitIndustry(row.industry)) {
    if (de >= 0 && de <= EXTREME_DE_RATIO) {
      leverage = de < 1.0 ? 1 : de > 2.0 ? -1 : 0;
    } else {
      const ic = n(row.interestCoverage);
      if (ic != null && ic < WEAK_INTEREST_COVERAGE) leverage = -1;
    }
  }

  // #3 — Revenue growth: > 10% → +1, < 0% → −1
  const revenueGrowth: -1 | 0 | 1 =
    revGrowth != null ? (revGrowth > 10 ? 1 : revGrowth < 0 ? -1 : 0) : 0;

  // #4 — FCF Yield level: > 5% → +1, < 2% → −1. Neutralized for financials.
  const fcfYieldLevel: -1 | 0 | 1 =
    fcf != null && !financial ? (fcf > 5 ? 1 : fcf < 2 ? -1 : 0) : 0;

  // #5 — P/E Compression: FWD < TTM → +1. Asymmetric for cyclicals: expected
  // EPS growth off a cycle ramp is never rewarded (+1 suppressed to 0), but
  // expected decline (FWD > TTM, estimates rolling over) is the honest peak
  // signal and keeps its −1.
  let peCompression: -1 | 0 | 1 = 0;
  if (pe != null && fwdPe != null) {
    peCompression = fwdPe < pe ? 1 : fwdPe > pe ? -1 : 0;
    if (peCompression === 1 && isCyclicalIndustry(row.industry)) peCompression = 0;
  }

  // #6 — Valuation: EV/EBITDA < 15 → +1, > 25 → −1. Neutralized for
  // financials (EBITDA is not meaningful for banks/insurers).
  const valuation: -1 | 0 | 1 =
    evEbitda != null && !financial ? (evEbitda < 15 ? 1 : evEbitda > 25 ? -1 : 0) : 0;

  // #7 — Dividend coverage: FCF > Div Yield → +1, FCF < Div Yield → −1.
  // Neutralized for financials (FCF-based).
  let dividendCoverage: -1 | 0 | 1 = 0;
  if (divYield != null && divYield > 0 && !financial) {
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

/** Below this criterion-coverage fraction a row cannot tier above weak. */
export const MIN_CRITERION_COVERAGE = 0.7;

/**
 * "Optically cheap" thresholds for the value-trap and peak-cycle gates. A
 * falling price (or peaking earnings) simultaneously improves FCF yield,
 * EV/EBITDA, dividend coverage, and 52W position while the deterioration shows
 * up in at most one −2 signal — so deep optical cheapness combined with an
 * independent decline signal caps the tier at Moderate instead of letting the
 * cheapness points add up to Strong.
 */
export const TRAP_CHEAP_EV_EBITDA = 8;  // EV/EBITDA below this is "deep cheap"
export const TRAP_CHEAP_FCF_YIELD = 8;  // FCF yield above this (%) is "deep cheap"

/** Deep optical cheapness on trailing numbers (either lens qualifies). */
export function isOpticallyCheap(row: ScanRow): boolean {
  const ev = row.evToEbitda != null && Number.isFinite(row.evToEbitda) ? row.evToEbitda : null;
  const fcf = row.fcfYieldPercent != null && Number.isFinite(row.fcfYieldPercent) ? row.fcfYieldPercent : null;
  return (ev != null && ev < TRAP_CHEAP_EV_EBITDA) || (fcf != null && fcf > TRAP_CHEAP_FCF_YIELD);
}

/**
 * Value-trap gate: optically cheap AND revenue shrinking. The cheapness is
 * likely the market pricing the decline, not a mispricing — capped at Moderate
 * and flagged. Suspect (neutralized) growth never triggers it.
 */
export function isValueTrap(row: ScanRow): boolean {
  const rev = sanitizeRevenueGrowth(row).value;
  return rev != null && rev < 0 && isOpticallyCheap(row);
}

/**
 * Peak-cycle gate: a cyclical that is optically cheap on trailing numbers
 * while forward estimates are already rolling over (FWD P/E > TTM P/E). That
 * combination is the classic top-of-cycle signature — trailing figures look
 * phenomenal precisely at the peak. Capped at Moderate and flagged.
 */
export function isPeakCycle(row: ScanRow): boolean {
  if (!isCyclicalIndustry(row.industry)) return false;
  const pe = row.trailingPE != null && Number.isFinite(row.trailingPE) ? row.trailingPE : null;
  const fwd = row.forwardPE != null && Number.isFinite(row.forwardPE) ? row.forwardPE : null;
  return pe != null && fwd != null && fwd > pe && isOpticallyCheap(row);
}

/**
 * Count how many applicable criteria actually had data. Deliberately-
 * neutralized criteria (financial FCF/valuation reads, financial/REIT leverage,
 * cyclical P/E compression) are excluded from the denominator — the framework
 * knowingly ignores them, so they aren't a data-quality gap. A suspect
 * (implausible) revenue-growth figure counts as UNcovered: bad data is no
 * better than missing data.
 */
export function computeCoverage(row: ScanRow): CriterionCoverage {
  const pe = n(row.trailingPE);
  const fwdPe = n(row.forwardPE);
  const fcf = n(row.fcfYieldPercent);
  const rev = sanitizeRevenueGrowth(row).value;
  const de = n(row.debtToEquity);
  const evEbitda = n(row.evToEbitda);
  const divYield = n(row.dividendYieldPercent);
  const ytd = n(row.ytdReturn);
  const rangePos = n(row.rangePosition != null ? clampFraction(row.rangePosition) : null);

  const financial = isFinancialIndustry(row.industry);
  const perCriterion: Record<keyof ScoreBreakdown, { applicable: boolean; covered: boolean }> = {
    earningsQuality: { applicable: !financial, covered: fcf != null && (fcf < 0 || pe != null) },
    leverage: { applicable: !financial && !isReitIndustry(row.industry), covered: de != null },
    revenueGrowth: { applicable: true, covered: rev != null },
    fcfYieldLevel: { applicable: !financial, covered: fcf != null },
    // Asymmetric for cyclicals (−1 still scores), so the criterion consumes data.
    peCompression: { applicable: true, covered: pe != null && fwdPe != null },
    valuation: { applicable: !financial, covered: evEbitda != null },
    dividendCoverage: { applicable: !financial, covered: divYield != null && (divYield <= 0 || fcf != null) },
    pricePosition: { applicable: true, covered: rangePos != null },
    ytdMomentum: { applicable: true, covered: ytd != null },
    dividendYield: { applicable: true, covered: divYield != null },
  };

  let covered = 0;
  let applicable = 0;
  for (const k of CRITERION_KEYS) {
    if (!perCriterion[k].applicable) continue;
    applicable += 1;
    if (perCriterion[k].covered) covered += 1;
  }
  return { covered, applicable, fraction: applicable === 0 ? 0 : covered / applicable };
}

/**
 * True when a row's data is too thin to trust a tier: coverage below the floor,
 * or a risk-critical input (FCF for cash conversion, D/E for leverage) missing
 * where those criteria apply.
 */
export function hasInsufficientData(row: ScanRow): boolean {
  const coverage = computeCoverage(row);
  if (coverage.fraction < MIN_CRITERION_COVERAGE) return true;
  const financial = isFinancialIndustry(row.industry);
  if (!financial && n(row.fcfYieldPercent) == null) return true;
  if (!financial && !isReitIndustry(row.industry) && n(row.debtToEquity) == null) return true;
  return false;
}

/**
 * A −1 Earnings Quality is "benign" — a growth/capex drag rather than a cash-
 * conversion red flag — when FCF is still solidly positive (≥ BENIGN_EQ_MIN_FCF_YIELD)
 * AND revenue is surging (> BENIGN_EQ_MIN_REV_GROWTH). Negative/weak FCF can never
 * qualify, so the cash-burn protection is preserved.
 */
export function isBenignEarningsQuality(row: ScanRow): boolean {
  const fcf = n(row.fcfYieldPercent);
  // Sanitized: an implausible provider growth figure can never grant the waiver.
  const rev = sanitizeRevenueGrowth(row).value;
  return fcf != null && fcf >= BENIGN_EQ_MIN_FCF_YIELD
      && rev != null && rev > BENIGN_EQ_MIN_REV_GROWTH;
}

/**
 * True when a Tier 1 criterion (Earnings Quality or Leverage) scores −1 and is
 * not waived. This is a hard disqualifier — the stock cannot be "strong" or
 * "moderate". A −1 Earnings Quality is waived when it's a benign growth drag
 * (see isBenignEarningsQuality); Leverage −1 is never waived here.
 */
export function isDisqualified(breakdown: ScoreBreakdown, row: ScanRow): boolean {
  const eqDisqualifies = breakdown.earningsQuality === -1 && !isBenignEarningsQuality(row);
  return eqDisqualifies || breakdown.leverage === -1;
}

/** Mega-cap trading in the top 10% of its 52-week range. */
export function isCrowded(row: ScanRow): boolean {
  const cap = n(row.marketCap);
  const pos = row.rangePosition != null ? clampFraction(row.rangePosition) : null;
  return cap != null && cap >= MEGA_CAP_THRESHOLD && pos != null && pos > 0.9;
}

/**
 * Map split scores + overlay flags to a neutral signal tier.
 * Hard floor: disqualified, risk ≥ RISK_FLOOR, or insufficient data → "weak"
 * regardless of strength. Crowding caps a stock at "moderate".
 */
export function tierFor(strengthScore: number, riskScore: number, flags: RowFlags): SignalTier {
  if (flags.disqualified || flags.insufficientData || riskScore >= RISK_FLOOR) return 'weak';
  const capped = flags.crowding || flags.valueTrap || flags.peakCycle;
  if (strengthScore >= 12) return capped ? 'moderate' : 'strong';
  if (strengthScore >= 7) return 'moderate';
  return 'weak';
}

export function scoreRow(row: ScanRow): ScoredRow {
  const breakdown = computeBreakdown(row);
  const { strength, risk } = computeScores(breakdown);
  const coverage = computeCoverage(row);
  const flags: RowFlags = {
    disqualified: isDisqualified(breakdown, row),
    cyclical: isCyclicalIndustry(row.industry),
    crowding: isCrowded(row),
    benignEarningsQuality: breakdown.earningsQuality === -1 && isBenignEarningsQuality(row),
    suspectRevenueGrowth: sanitizeRevenueGrowth(row).suspect,
    insufficientData: hasInsufficientData(row),
    valueTrap: isValueTrap(row),
    peakCycle: isPeakCycle(row),
  };
  return {
    row,
    breakdown,
    strengthScore: strength,
    riskScore: risk,
    coverage,
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
      if (isFinancialIndustry(row.industry)) return 'financial — FCF-based read neutralized';
      if (fcf != null && fcf < 0) return `FCF ${formatPercent(fcf)} (negative)`;
      if (fcf != null && pe != null && pe > 0) {
        return `FCF/NI ${formatRatio((fcf * pe) / 100)} (FCF ${formatPercent(fcf)} vs EY ${formatPercent(100 / pe)})`;
      }
      return 'no data';
    case 'leverage': {
      if (de == null) return 'no data';
      if (isFinancialIndustry(row.industry)) return `D/E ${formatRatio(de)} · financial — neutralized`;
      if (isReitIndustry(row.industry)) return `D/E ${formatRatio(de)} · REIT — neutralized`;
      if (de < 0 || de > EXTREME_DE_RATIO) {
        const base = de < 0 ? 'neg. equity' : 'buyback-distorted';
        const ic = n(row.interestCoverage);
        if (ic == null) return `D/E ${formatRatio(de)} · ${base} — neutralized (no coverage data)`;
        return ic < WEAK_INTEREST_COVERAGE
          ? `D/E ${formatRatio(de)} · distorted + int. coverage ${formatRatio(ic)} — debt is a live threat`
          : `D/E ${formatRatio(de)} · ${base} — neutralized (int. coverage ${formatRatio(ic)})`;
      }
      return `D/E ${formatRatio(de)}`;
    }
    case 'revenueGrowth': {
      if (rev == null) return 'no data';
      return sanitizeRevenueGrowth(row).suspect
        ? `${formatReturn(rev)} YoY · implausible — neutralized (verify at source)`
        : `${formatReturn(rev)} YoY`;
    }
    case 'fcfYieldLevel':
      if (isFinancialIndustry(row.industry)) return 'financial — FCF-based read neutralized';
      return fcf != null ? formatPercent(fcf) : 'no data';
    case 'peCompression':
      if (pe == null || fwdPe == null) return 'no data';
      return isCyclicalIndustry(row.industry) && fwdPe < pe
        ? `Fwd ${formatPe(fwdPe)} vs TTM ${formatPe(pe)} · cyclical — neutralized`
        : `Fwd ${formatPe(fwdPe)} vs TTM ${formatPe(pe)}`;
    case 'valuation':
      if (isFinancialIndustry(row.industry)) return 'financial — EV/EBITDA neutralized';
      return ev != null ? `EV/EBITDA ${formatRatio(ev)}` : 'no data';
    case 'dividendCoverage':
      if (isFinancialIndustry(row.industry)) return 'financial — FCF-based read neutralized';
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
  earningsQuality: { positive: 'FCF/NI conversion > 1.0', negative: 'FCF/NI < 0.7, or FCF < 0 (neutral: financials)' },
  leverage: { positive: 'D/E < 1.0', negative: 'D/E 2.0–10, or distorted D/E with int. coverage < 2 (neutral: financials, REITs)' },
  revenueGrowth: { positive: '> 10% YoY', negative: '< 0% (declining); implausible values neutralized' },
  fcfYieldLevel: { positive: '> 5%', negative: '< 2% (neutral: financials)' },
  peCompression: { positive: 'Fwd < TTM (neutral: cyclicals)', negative: 'Fwd > TTM (incl. cyclicals)' },
  valuation: { positive: 'EV/EBITDA < 15', negative: '> 25 (neutral: financials)' },
  dividendCoverage: { positive: 'FCF Yield > Dividend Yield', negative: 'FCF < Dividend (non-payers, financials: 0)' },
  pricePosition: { positive: '< 40% of 52W range', negative: '> 90% of range' },
  ytdMomentum: { positive: 'positive YTD', negative: 'negative YTD' },
  dividendYield: { positive: '> 1.5% (non-payers: 0)', negative: '—' },
};
