import type { ScanRow } from './types';
import { clampFraction } from './range';

// ---------------------------------------------------------------------------
// Master Scoring Framework — 10 criteria, weighted by significance tier.
//
//   Tier 1 (×3) — Survival & Quality:  Earnings Quality, Leverage
//   Tier 2 (×2) — Fundamental Strength: Revenue Growth, FCF Yield, P/E Compression
//   Tier 3 (×1) — Valuation / Timing:   EV/EBITDA, Dividend Coverage,
//                                        52W Position, YTD, Dividend Yield
//
// Each raw signal is +1 / 0 / −1, then multiplied by its tier weight.
// Max +17, Min −16 (Dividend Yield can't go negative).
//
// Hard floor rule: −3 on Earnings Quality or Leverage forces tier to "pass"
// regardless of total score.  These are eliminators, not factors.
// ---------------------------------------------------------------------------

/** Raw signal before weighting. */
export interface ScoreBreakdown {
  /** #1 — Earnings quality: FCF Yield vs Earnings Yield. ×3 */
  earningsQuality: -1 | 0 | 1;
  /** #2 — Leverage: D/E assessment. ×3 */
  leverage: -1 | 0 | 1;
  /** #3 — Revenue growth > 10%. ×2 */
  revenueGrowth: -1 | 0 | 1;
  /** #4 — FCF Yield > 5%. ×2 */
  fcfYieldLevel: -1 | 0 | 1;
  /** #5 — P/E compression: FWD < TTM. ×2 */
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

export type ConvictionTier = 'high' | 'watchlist' | 'pass';

export interface ScoredRow {
  row: ScanRow;
  /** Weighted total score (−16 to +17). */
  score: number;
  breakdown: ScoreBreakdown;
  tier: ConvictionTier;
  /** True when Earnings Quality or Leverage hit −3 (disqualifier). */
  disqualified: boolean;
}

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

  // #2 — Leverage: D/E < 1.0 → +1, > 2.0 → −1
  const leverage: -1 | 0 | 1 =
    de != null ? (de < 1.0 ? 1 : de > 2.0 ? -1 : 0) : 0;

  // #3 — Revenue growth: > 10% → +1, < 0% → −1
  const revenueGrowth: -1 | 0 | 1 =
    revGrowth != null ? (revGrowth > 10 ? 1 : revGrowth < 0 ? -1 : 0) : 0;

  // #4 — FCF Yield level: > 5% → +1, < 2% → −1
  const fcfYieldLevel: -1 | 0 | 1 =
    fcf != null ? (fcf > 5 ? 1 : fcf < 2 ? -1 : 0) : 0;

  // #5 — P/E Compression: FWD < TTM → +1
  const peCompression: -1 | 0 | 1 =
    pe != null && fwdPe != null ? (fwdPe < pe ? 1 : fwdPe > pe ? -1 : 0) : 0;

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

/** Weighted total across all 10 criteria. Range: −16 to +17. */
export function totalScore(breakdown: ScoreBreakdown): number {
  let sum = 0;
  for (const k of CRITERION_KEYS) {
    sum += breakdown[k] * CRITERION_WEIGHT[k];
  }
  return sum;
}

/**
 * Returns true when a Tier 1 criterion (Earnings Quality or Leverage) scores
 * −1, meaning its weighted contribution is −3. This is a hard disqualifier —
 * the stock cannot be "high" or "watchlist" regardless of total score.
 */
export function isDisqualified(breakdown: ScoreBreakdown): boolean {
  return breakdown.earningsQuality === -1 || breakdown.leverage === -1;
}

export function convictionTier(score: number, disqualified: boolean): ConvictionTier {
  if (disqualified) return 'pass';
  if (score >= 12) return 'high';
  if (score >= 7) return 'watchlist';
  return 'pass';
}

export function scoreRow(row: ScanRow): ScoredRow {
  const breakdown = computeBreakdown(row);
  const score = totalScore(breakdown);
  const disqualified = isDisqualified(breakdown);
  return { row, score, breakdown, tier: convictionTier(score, disqualified), disqualified };
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
