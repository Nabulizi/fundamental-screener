import type { ScanRow } from './types';
import { clampFraction } from './range';
import { formatPercent, formatReturn, formatPe, formatRatio } from './format';

// ---------------------------------------------------------------------------
// Master Scoring Framework (v5) — 12 criteria, weighted by significance tier,
// split into two independent scores instead of one signed total.
//
//   Tier 1 (×3) — Survival & Quality:  Earnings Quality, Leverage
//   Tier 2 (×2) — Fundamental Strength: Revenue Growth, Revenue Acceleration,
//                                        FCF Yield, Margin Inflection,
//                                        P/E Compression
//   Tier 3 (×1) — Valuation / Timing:   EV/EBITDA, Dividend Coverage,
//                                        52W Position, YTD, Dividend Yield
//
// Each raw signal is +1 / 0 / −1, then multiplied by its tier weight.
//   • Strength Score = sum of the POSITIVE weighted signals  (0 … +21)
//   • Risk Score     = sum of the |NEGATIVE| weighted signals (0 … 20)
//
// The two improvement criteria (acceleration, margin inflection) score the
// DERIVATIVE of the business, not its level — turnarounds and pre-recognition
// improvers show up there first. Tier thresholds are deliberately unchanged:
// rows without the improvement data score exactly as before, and improvement
// signals can legitimately lift a stock a tier.
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
  /** #4 — Revenue acceleration: quarterly YoY vs TTM YoY (±3pp band). ×2 */
  revenueAcceleration: -1 | 0 | 1;
  /** #5 — FCF Yield > 5%. ×2 */
  fcfYieldLevel: -1 | 0 | 1;
  /** #6 — Margin inflection: TTM operating margin vs 5Y average (±1pp band). ×2 */
  marginInflection: -1 | 0 | 1;
  /** #7 — P/E compression: FWD < TTM (asymmetric for cyclicals). ×2 */
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
   * A provider revenue-growth figure (TTM or quarterly) was implausible
   * (beyond the sanity bounds) — neutralized rather than scored. Verify at
   * the source.
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
  /**
   * Leverage scored −1 (D/E > 2) but interest coverage is strong — the debt is
   * comfortably serviced, so the −1 costs Risk without disqualifying.
   */
  serviceableLeverage: boolean;
  /**
   * Earnings Quality scored −1 in the soft band (conversion 0.5–0.7, FCF
   * positive, not a benign growth drag). Costs Risk and caps the tier at
   * moderate — an unresolved quality question, not an elimination.
   */
  softEarningsQuality: boolean;
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
  /** Sum of positive weighted signals. 0 … MAX_STRENGTH. */
  strengthScore: number;
  /** Sum of |negative| weighted signals. 0 … MAX_RISK. */
  riskScore: number;
  coverage: CriterionCoverage;
  flags: RowFlags;
  tier: SignalTier;
}

/** Strength score when every criterion is +1. */
export const MAX_STRENGTH = 21;
/** Risk score when every (negatable) criterion is −1. */
export const MAX_RISK = 20;
/** Risk score at/above which a stock is forced to "weak" regardless of strength. */
export const RISK_FLOOR = 8;

/**
 * Methodology version stamped into scan snapshots (lib/snapshotStore.ts).
 * BUMP THIS whenever criteria, thresholds, or weights change — it separates
 * methodology eras in the longitudinal record so v3 scores are never compared
 * naively against scores produced by different rules.
 */
export const SCORING_VERSION = 5;

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
/** Interest coverage below this is fatal — the company cannot service its debt. */
export const WEAK_INTEREST_COVERAGE = 2;
/**
 * Interest coverage at/above this waives a D/E-driven leverage −1 from the
 * hard-floor disqualifier (it still costs Risk). D/E is the profession's least
 * reliable leverage metric — book equity is an accounting residual — while
 * coverage answers the actual survival question: can the company service what
 * it owes? A levered-by-choice cash generator (DELL-style) keeps its risk
 * points but is not eliminated.
 */
export const STRONG_INTEREST_COVERAGE = 6;

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
function sanitizeGrowthValue(raw: number | null | undefined, industry: string | null | undefined): { value: number | null; suspect: boolean } {
  const v = raw != null && Number.isFinite(raw) ? raw : null;
  if (v == null) return { value: null, suspect: false };
  const bound = isFinancialIndustry(industry) ? SUSPECT_REV_GROWTH_FINANCIAL : SUSPECT_REV_GROWTH_GENERAL;
  return v < -100 || v > bound ? { value: null, suspect: true } : { value: v, suspect: false };
}

export function sanitizeRevenueGrowth(row: ScanRow): { value: number | null; suspect: boolean } {
  return sanitizeGrowthValue(row.revenueGrowthTTM, row.industry);
}

/** Quarterly YoY growth under the same sanity bounds as the TTM figure. */
export function sanitizeQuarterlyRevGrowth(row: ScanRow): { value: number | null; suspect: boolean } {
  return sanitizeGrowthValue(row.revenueGrowthQuarterly, row.industry);
}

const bounded = (value: number | null | undefined, min: number, max: number): number | null =>
  value != null && Number.isFinite(value) && value >= min && value <= max ? value : null;

/**
 * Single scoring input boundary. Provider values outside defensible sanity
 * ranges become missing before any criterion, coverage rule, or overlay sees
 * them. The raw row remains available for display/provenance and verification.
 */
export function sanitizeScoreRow(row: ScanRow): ScanRow {
  return {
    ...row,
    marketCap: bounded(row.marketCap, Number.MIN_VALUE, Number.MAX_VALUE),
    currentPrice: bounded(row.currentPrice, Number.MIN_VALUE, Number.MAX_VALUE),
    trailingPE: bounded(row.trailingPE, Number.MIN_VALUE, 1_000),
    forwardPE: bounded(row.forwardPE, Number.MIN_VALUE, 1_000),
    dividendYieldPercent: bounded(row.dividendYieldPercent, 0, 25),
    ytdReturn: bounded(row.ytdReturn, -100, 1_000),
    fcfYieldPercent: bounded(row.fcfYieldPercent, -100, 100),
    revenueGrowthTTM: sanitizeRevenueGrowth(row).value,
    revenueGrowthQuarterly: sanitizeQuarterlyRevGrowth(row).value,
    evToEbitda: bounded(row.evToEbitda, Number.MIN_VALUE, 1_000),
    interestCoverage: bounded(row.interestCoverage, -10_000, 10_000),
    operatingMarginTTM: bounded(row.operatingMarginTTM, -200, 100),
    operatingMargin5Y: bounded(row.operatingMargin5Y, -200, 100),
    rangePosition: bounded(row.rangePosition, 0, 1),
  };
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
 * Below this conversion the Earnings Quality −1 is a hard disqualifier; in the
 * soft band [EQ_CONVERSION_CRITICAL, EQ_CONVERSION_WEAK) it costs Risk and caps
 * the tier at Moderate instead. A binary cliff on one noisy TTM datapoint was
 * below institutional evidence standards — a 30–50% conversion shortfall is an
 * unresolved quality question (working-capital swing? capex cycle?), not proof
 * of fabricated earnings; negative FCF and sub-0.5 conversion remain
 * unambiguous eliminations.
 */
export const EQ_CONVERSION_CRITICAL = 0.5;

/**
 * A −1 Earnings Quality is treated as a benign growth/capex drag — not a cash-
 * conversion red flag — when FCF is still at least neutral-grade AND revenue is
 * surging. Fast growth mechanically inflates receivables and justifies heavy
 * capex, so FCF legitimately trails (the larger) reported earnings. Such a −1
 * still costs Risk points but is waived from the hard-floor disqualifier.
 */
export const BENIGN_EQ_MIN_FCF_YIELD = 2;    // FCF yield must be ≥ this (not weak/negative)
export const BENIGN_EQ_MIN_REV_GROWTH = 20;  // revenue growth must exceed this (hyper-growth)

/**
 * Improvement thresholds. Levels tell you where a business IS; these two
 * criteria score the DERIVATIVE — where it's heading — which is what
 * turnarounds and pre-recognition improvers show first. Both use the same
 * `metric=all` response the app already fetches (zero extra API calls).
 */
export const REV_ACCEL_THRESHOLD_PP = 3;   // quarterly YoY vs TTM YoY, in percentage points
export const MARGIN_INFLECTION_PP = 1;     // TTM operating margin vs 5Y average, in pp

/** Tier weight for each criterion, ordered by significance. */
export const CRITERION_WEIGHT: Record<keyof ScoreBreakdown, number> = {
  earningsQuality: 3,
  leverage: 3,
  revenueGrowth: 2,
  revenueAcceleration: 2,
  fcfYieldLevel: 2,
  marginInflection: 2,
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
  revenueAcceleration: 'Revenue Acceleration',
  fcfYieldLevel: 'FCF Yield Level',
  marginInflection: 'Margin Inflection',
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
  'revenueAcceleration',
  'fcfYieldLevel',
  'marginInflection',
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
// These patterns are the label-based FALLBACK for classifyFinancialModel (below):
// they can't tell an economic business model from a sector label, so a curated
// ticker-override layer sits in front of them. Card lenders labeled "Credit
// Services" (which these miss) and asset-light names labeled financially (data,
// exchanges, ratings, payment networks — real DCF-able FCF) are corrected by the
// overrides. An UNRECOGNIZED-but-financial label falls through to here and is
// treated conservatively as balance-sheet (neutralized) — hence the override
// list must stay small and reviewed so genuine fee businesses aren't gated.
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

export type FinancialModel = 'balance-sheet' | 'asset-light' | 'non-financial';

// Curated ticker overrides — ONLY for names whose industry LABEL misclassifies
// their economic model. Keyed by upper-case ticker.
//
// MAINTENANCE: keep this list SMALL and review it periodically. Industry labels
// drift, companies get acquired or reclassified, and new ambiguous names appear.
// The regex fallback (isFinancialIndustry) handles the unambiguous bulk; only add
// a ticker here when its label sends it to the wrong bucket. Adding or removing a
// ticker changes scorecard neutralization → bump SCORING_VERSION.
const OVERRIDE_BALANCE_SHEET = new Set([
  // Card / consumer lenders: hold receivables + credit risk but are labeled
  // "Credit Services" (which the regex misses) — must be gated like banks.
  'COF', 'DFS', 'AXP', 'SYF', 'ALLY',
]);
const OVERRIDE_ASSET_LIGHT = new Set([
  // Fee / data / index / exchange / network businesses with real, DCF-able FCF —
  // must NOT be gated even though the label looks financial.
  'BLK', 'TROW', 'BEN',                  // asset managers
  'CME', 'ICE', 'NDAQ', 'CBOE',          // exchanges
  'SPGI', 'MCO', 'MSCI', 'FDS', 'MORN',  // ratings / data / index
  'V', 'MA',                             // payment networks
]);

/**
 * Classify a company's financial business MODEL, not just its sector label.
 * Balance-sheet/spread businesses (banks, insurers, brokers holding customer
 * assets, card lenders) → 'balance-sheet' (FCF-neutralized in scoring, DCF-gated).
 * Asset-light fee/data/exchange/network financials have real FCF → 'asset-light'
 * (scored and DCF'd normally). Everything else → 'non-financial'.
 *
 * Curated ticker overrides win; otherwise it falls back to the industry-label
 * regex, which conservatively treats an unrecognized financial label as
 * balance-sheet (same as pre-Phase-5 behavior).
 */
export function classifyFinancialModel(
  ticker: string | null | undefined,
  industry: string | null | undefined
): FinancialModel {
  const t = (ticker ?? '').trim().toUpperCase();
  if (OVERRIDE_BALANCE_SHEET.has(t)) return 'balance-sheet';
  if (OVERRIDE_ASSET_LIGHT.has(t)) return 'asset-light';
  return isFinancialIndustry(industry) ? 'balance-sheet' : 'non-financial';
}

/**
 * True when a company should be treated as a balance-sheet financial — FCF is
 * noise, so scoring neutralizes FCF-derived criteria and the detail-page DCF is
 * gated off. The SINGLE predicate both the scorecard and the DCF gate call, so
 * they never diverge. (The revenue-growth suspect bound in sanitizeGrowthValue
 * deliberately stays on the label regex — it guards a provider label artifact,
 * not the economic model.)
 *
 * We intentionally show NO sector-native replacement (P/B, ROE, FFO, combined
 * ratio, CET1, …) for these names: a provider-capability check found the data is
 * mostly absent or extraction-ambiguous. See docs/sector-coverage.md (and
 * `npm run probe -- --sector`) for the evidence and what would be required first.
 */
export function isBalanceSheetFinancial(
  ticker: string | null | undefined,
  industry: string | null | undefined
): boolean {
  return classifyFinancialModel(ticker, industry) === 'balance-sheet';
}

function n(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function computeBreakdown(input: ScanRow): ScoreBreakdown {
  const row = sanitizeScoreRow(input);
  const pe = n(row.trailingPE);
  const fwdPe = n(row.forwardPE);
  const fcf = n(row.fcfYieldPercent);
  const revGrowth = sanitizeRevenueGrowth(row).value;
  const de = n(row.debtToEquity);
  const evEbitda = n(row.evToEbitda);
  const divYield = n(row.dividendYieldPercent);
  const ytd = n(row.ytdReturn);
  const rangePos = n(row.rangePosition != null ? clampFraction(row.rangePosition) : null);

  const financial = isBalanceSheetFinancial(row.ticker, row.industry);

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

  // #2 — Leverage, coverage-first: weak interest coverage (< 2) is −1 at ANY
  // D/E — a company that can't service its debt is dangerous regardless of the
  // ratio's shape. Otherwise D/E scores in the normal band (< 1.0 → +1,
  // > 2.0 → −1); distorted ratios (negative or > EXTREME_DE_RATIO) with
  // adequate/unknown coverage stay neutral. Financials and REITs: neutralized
  // (leverage is structural). Whether a −1 also DISQUALIFIES is decided in
  // isDisqualified (strong coverage waives it).
  let leverage: -1 | 0 | 1 = 0;
  if (de != null && !financial && !isReitIndustry(row.industry)) {
    const ic = n(row.interestCoverage);
    if (ic != null && ic < WEAK_INTEREST_COVERAGE) {
      leverage = -1;
    } else if (de >= 0 && de <= EXTREME_DE_RATIO) {
      leverage = de < 1.0 ? 1 : de > 2.0 ? -1 : 0;
    }
  }

  // #3 — Revenue growth: > 10% → +1, < 0% → −1
  const revenueGrowth: -1 | 0 | 1 =
    revGrowth != null ? (revGrowth > 10 ? 1 : revGrowth < 0 ? -1 : 0) : 0;

  // #4 — Revenue acceleration: most-recent-quarter YoY vs TTM YoY. Scores the
  // derivative of growth — accelerating out of a decline is the turnaround
  // signature. Both figures must pass the sanity bounds.
  const revQ = sanitizeQuarterlyRevGrowth(row).value;
  let revenueAcceleration: -1 | 0 | 1 = 0;
  if (revGrowth != null && revQ != null) {
    revenueAcceleration =
      revQ > revGrowth + REV_ACCEL_THRESHOLD_PP ? 1 :
      revQ < revGrowth - REV_ACCEL_THRESHOLD_PP ? -1 : 0;
  }

  // #5 — FCF Yield level: > 5% → +1, < 2% → −1. Neutralized for financials.
  const fcfYieldLevel: -1 | 0 | 1 =
    fcf != null && !financial ? (fcf > 5 ? 1 : fcf < 2 ? -1 : 0) : 0;

  // #6 — Margin inflection: TTM operating margin vs its own 5Y average.
  // Above the baseline → operating leverage kicking in; below → compressing.
  const opTtm = n(row.operatingMarginTTM);
  const op5y = n(row.operatingMargin5Y);
  let marginInflection: -1 | 0 | 1 = 0;
  if (opTtm != null && op5y != null) {
    marginInflection =
      opTtm > op5y + MARGIN_INFLECTION_PP ? 1 :
      opTtm < op5y - MARGIN_INFLECTION_PP ? -1 : 0;
  }

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
    revenueAcceleration,
    fcfYieldLevel,
    marginInflection,
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

/**
 * Deep optical cheapness on trailing numbers (either lens qualifies). Never
 * true for financials: both lenses (FCF yield, EV/EBITDA) are the same data
 * the scorer neutralizes for them — noise cannot make a bank "cheap".
 */
export function isOpticallyCheap(row: ScanRow): boolean {
  if (isBalanceSheetFinancial(row.ticker, row.industry)) return false;
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
 *
 * Known limitation: a provider gap and a structurally-inapplicable metric are
 * indistinguishable here (providers normalize a loss-maker's P/E to null the
 * same way as a missing one), so unprofitable companies max out below full
 * coverage and sparse young names tend toward the insufficient-data floor.
 * That errs conservative, which is the intended direction.
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

  const financial = isBalanceSheetFinancial(row.ticker, row.industry);
  const perCriterion: Record<keyof ScoreBreakdown, { applicable: boolean; covered: boolean }> = {
    earningsQuality: { applicable: !financial, covered: fcf != null && (fcf < 0 || pe != null) },
    leverage: { applicable: !financial && !isReitIndustry(row.industry), covered: de != null },
    revenueGrowth: { applicable: true, covered: rev != null },
    revenueAcceleration: { applicable: true, covered: rev != null && sanitizeQuarterlyRevGrowth(row).value != null },
    fcfYieldLevel: { applicable: !financial, covered: fcf != null },
    marginInflection: { applicable: true, covered: n(row.operatingMarginTTM) != null && n(row.operatingMargin5Y) != null },
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
export function hasInsufficientData(row: ScanRow, coverage: CriterionCoverage = computeCoverage(row)): boolean {
  if (coverage.fraction < MIN_CRITERION_COVERAGE) return true;
  const financial = isBalanceSheetFinancial(row.ticker, row.industry);
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
 * True when the Earnings Quality −1 is in the unambiguous elimination zone:
 * negative FCF (cash burn) or conversion below EQ_CONVERSION_CRITICAL. The
 * soft band above it costs Risk and caps the tier instead of eliminating.
 */
export function isCriticalEarningsQuality(row: ScanRow): boolean {
  const fcf = n(row.fcfYieldPercent);
  const pe = n(row.trailingPE);
  if (fcf == null) return false;
  if (fcf < 0) return true;
  if (pe != null && pe > 0) return (fcf * pe) / 100 < EQ_CONVERSION_CRITICAL;
  return false;
}

/**
 * True when a leverage −1 is serviceable: interest coverage is strong enough
 * (≥ STRONG_INTEREST_COVERAGE) that the debt, while large, is comfortably
 * carried. The −1 still costs Risk but is waived from the hard floor.
 */
export function isServiceableLeverage(row: ScanRow): boolean {
  const ic = n(row.interestCoverage);
  return ic != null && ic >= STRONG_INTEREST_COVERAGE;
}

/**
 * Which Tier 1 criterion is driving a disqualification (both may fire). The
 * single source of truth for cause attribution — the UI banner reads this
 * rather than re-deriving the waiver logic.
 */
export function disqualificationCauses(breakdown: ScoreBreakdown, row: ScanRow): { earningsQuality: boolean; leverage: boolean } {
  return {
    earningsQuality:
      breakdown.earningsQuality === -1
      && isCriticalEarningsQuality(row)
      && !isBenignEarningsQuality(row),
    leverage: breakdown.leverage === -1 && !isServiceableLeverage(row),
  };
}

/**
 * True when a Tier 1 criterion (Earnings Quality or Leverage) scores −1 and is
 * not waived. This is a hard disqualifier — the stock cannot be "strong" or
 * "moderate". Waivers: a benign growth-drag EQ (isBenignEarningsQuality), a
 * soft-band EQ (capped at Moderate instead — see isCriticalEarningsQuality),
 * and serviceable leverage (isServiceableLeverage).
 */
export function isDisqualified(breakdown: ScoreBreakdown, row: ScanRow): boolean {
  const causes = disqualificationCauses(breakdown, row);
  return causes.earningsQuality || causes.leverage;
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
  const capped = flags.crowding || flags.valueTrap || flags.peakCycle || flags.softEarningsQuality;
  if (strengthScore >= 12) return capped ? 'moderate' : 'strong';
  if (strengthScore >= 7) return 'moderate';
  return 'weak';
}

export function scoreRow(rawRow: ScanRow): ScoredRow {
  const row = sanitizeScoreRow(rawRow);
  const breakdown = computeBreakdown(row);
  const { strength, risk } = computeScores(breakdown);
  const coverage = computeCoverage(row);
  const flags: RowFlags = {
    disqualified: isDisqualified(breakdown, row),
    cyclical: isCyclicalIndustry(row.industry),
    crowding: isCrowded(row),
    benignEarningsQuality: breakdown.earningsQuality === -1 && isBenignEarningsQuality(row),
    suspectRevenueGrowth: sanitizeRevenueGrowth(rawRow).suspect || sanitizeQuarterlyRevGrowth(rawRow).suspect,
    insufficientData: hasInsufficientData(row, coverage),
    valueTrap: isValueTrap(row),
    peakCycle: isPeakCycle(row),
    serviceableLeverage: breakdown.leverage === -1 && isServiceableLeverage(row),
    softEarningsQuality:
      breakdown.earningsQuality === -1
      && !isCriticalEarningsQuality(row)
      && !isBenignEarningsQuality(row),
  };
  return {
    row: rawRow,
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
      if (isBalanceSheetFinancial(row.ticker, row.industry)) return 'financial — FCF-based read neutralized';
      if (fcf != null && fcf < 0) return `FCF ${formatPercent(fcf)} (negative)`;
      if (fcf != null && pe != null && pe > 0) {
        return `FCF/NI ${formatRatio((fcf * pe) / 100)} (FCF ${formatPercent(fcf)} vs EY ${formatPercent(100 / pe)})`;
      }
      return 'no data';
    case 'leverage': {
      if (de == null) return 'no data';
      if (isBalanceSheetFinancial(row.ticker, row.industry)) return `D/E ${formatRatio(de)} · financial — neutralized`;
      if (isReitIndustry(row.industry)) return `D/E ${formatRatio(de)} · REIT — neutralized`;
      const ic = n(row.interestCoverage);
      if (ic != null && ic < WEAK_INTEREST_COVERAGE) {
        return `D/E ${formatRatio(de)} · int. coverage ${formatRatio(ic)} — cannot service debt`;
      }
      if (de < 0 || de > EXTREME_DE_RATIO) {
        const base = de < 0 ? 'neg. equity' : 'buyback-distorted';
        return ic == null
          ? `D/E ${formatRatio(de)} · ${base} — neutralized (no coverage data)`
          : `D/E ${formatRatio(de)} · ${base} — neutralized (int. coverage ${formatRatio(ic)})`;
      }
      if (de > 2.0 && ic != null && ic >= STRONG_INTEREST_COVERAGE) {
        return `D/E ${formatRatio(de)} · int. coverage ${formatRatio(ic)} — serviceable (risk, not disqualifying)`;
      }
      return ic != null ? `D/E ${formatRatio(de)} · int. coverage ${formatRatio(ic)}` : `D/E ${formatRatio(de)}`;
    }
    case 'revenueGrowth': {
      if (rev == null) return 'no data';
      return sanitizeRevenueGrowth(row).suspect
        ? `${formatReturn(rev)} YoY · implausible — neutralized (verify at source)`
        : `${formatReturn(rev)} YoY`;
    }
    case 'revenueAcceleration': {
      const qs = sanitizeQuarterlyRevGrowth(row);
      const ts = sanitizeRevenueGrowth(row);
      if (qs.suspect || ts.suspect) {
        const rawQ = n(row.revenueGrowthQuarterly);
        const rawT = n(row.revenueGrowthTTM);
        return `Q ${rawQ != null ? formatReturn(rawQ) : 'n/a'} vs TTM ${rawT != null ? formatReturn(rawT) : 'n/a'} · implausible — neutralized (verify at source)`;
      }
      if (qs.value == null || ts.value == null) return 'no data';
      return `Q ${formatReturn(qs.value)} vs TTM ${formatReturn(ts.value)} YoY`;
    }
    case 'fcfYieldLevel':
      if (isBalanceSheetFinancial(row.ticker, row.industry)) return 'financial — FCF-based read neutralized';
      return fcf != null ? formatPercent(fcf) : 'no data';
    case 'marginInflection': {
      const t = n(row.operatingMarginTTM);
      const avg = n(row.operatingMargin5Y);
      if (t == null || avg == null) return 'no data';
      return `Op margin ${formatPercent(t)} vs 5Y avg ${formatPercent(avg)}`;
    }
    case 'peCompression':
      if (pe == null || fwdPe == null) return 'no data';
      return isCyclicalIndustry(row.industry) && fwdPe < pe
        ? `Fwd ${formatPe(fwdPe)} vs TTM ${formatPe(pe)} · cyclical — neutralized`
        : `Fwd ${formatPe(fwdPe)} vs TTM ${formatPe(pe)}`;
    case 'valuation':
      if (isBalanceSheetFinancial(row.ticker, row.industry)) return 'financial — EV/EBITDA neutralized';
      return ev != null ? `EV/EBITDA ${formatRatio(ev)}` : 'no data';
    case 'dividendCoverage':
      if (isBalanceSheetFinancial(row.ticker, row.industry)) return 'financial — FCF-based read neutralized';
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
  earningsQuality: { positive: 'FCF/NI conversion > 1.0', negative: 'FCF/NI < 0.7 (disqualifies < 0.5 or FCF < 0; 0.5–0.7 caps at Moderate) (neutral: financials)' },
  leverage: { positive: 'D/E < 1.0', negative: 'Int. coverage < 2 (any D/E), or D/E 2.0–10 (waived from disqualifying when coverage ≥ 6) (neutral: financials, REITs)' },
  revenueGrowth: { positive: '> 10% YoY', negative: '< 0% (declining); implausible values neutralized' },
  revenueAcceleration: { positive: 'Quarterly YoY > TTM YoY + 3pp', negative: 'Quarterly YoY < TTM YoY − 3pp' },
  fcfYieldLevel: { positive: '> 5%', negative: '< 2% (neutral: financials)' },
  marginInflection: { positive: 'Op margin TTM > 5Y avg + 1pp', negative: 'Op margin TTM < 5Y avg − 1pp' },
  peCompression: { positive: 'Fwd < TTM (neutral: cyclicals)', negative: 'Fwd > TTM (incl. cyclicals)' },
  valuation: { positive: 'EV/EBITDA < 15', negative: '> 25 (neutral: financials)' },
  dividendCoverage: { positive: 'FCF Yield > Dividend Yield', negative: 'FCF < Dividend (non-payers, financials: 0)' },
  pricePosition: { positive: '< 40% of 52W range', negative: '> 90% of range' },
  ytdMomentum: { positive: 'positive YTD', negative: 'negative YTD' },
  dividendYield: { positive: '> 1.5% (non-payers: 0)', negative: '—' },
};
