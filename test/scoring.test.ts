import { describe, it, expect } from 'vitest';
import type { ScanRow } from '@/lib/types';
import {
  computeBreakdown,
  computeScores,
  totalScore,
  tierFor,
  scoreRow,
  breakdownTooltip,
  criterionEvidence,
  isDisqualified,
  isBenignEarningsQuality,
  isCrowded,
  isCyclicalIndustry,
  isFinancialIndustry,
  classifyFinancialModel,
  isBalanceSheetFinancial,
  computeCoverage,
  CRITERION_WEIGHT,
  CRITERION_BENCHMARK,
  CRITERION_KEYS,
  MEGA_CAP_THRESHOLD,
  SCORING_VERSION,
  type ScoreBreakdown,
  type RowFlags,
} from '@/lib/scoring';

/** Minimal valid ScanRow with all nulls — scores should be all zeros. */
function blankRow(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'TEST',
    companyName: 'Test Co',
    industry: 'Software',
    marketCap: 1_000_000_000,
    currency: 'USD',
    week52Low: null,
    week52High: null,
    trailingPE: null,
    forwardPE: null,
    dividendYieldPercent: null,
    currentPrice: null,
    ytdReturn: null,
    fcfYieldPercent: null,
    revenueGrowthTTM: null,
    debtToEquity: null,
    evToEbitda: null,
    rangePosition: null,
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

const NO_FLAGS: RowFlags = { disqualified: false, cyclical: false, crowding: false, benignEarningsQuality: false, suspectRevenueGrowth: false, insufficientData: false, valueTrap: false, peakCycle: false, serviceableLeverage: false, softEarningsQuality: false };

/** Fully-populated non-financial row (12/12 criteria have data; improvement fields neutral). */
function fullRow(overrides: Partial<ScanRow> = {}): ScanRow {
  return blankRow({
    trailingPE: 20, forwardPE: 15, fcfYieldPercent: 8, revenueGrowthTTM: 15,
    revenueGrowthQuarterly: 15, operatingMarginTTM: 20, operatingMargin5Y: 20,
    debtToEquity: 0.5, evToEbitda: 10, dividendYieldPercent: 3,
    rangePosition: 0.3, ytdReturn: 10, ...overrides,
  });
}

describe('computeBreakdown', () => {
  it('returns all zeros for a blank row', () => {
    const b = computeBreakdown(blankRow());
    const values = Object.values(b);
    expect(values.every((v) => v === 0)).toBe(true);
  });

  // --- #1 Earnings Quality (×3) ---
  it('+1 when FCF Yield > Earnings Yield by 1pp+', () => {
    const b = computeBreakdown(blankRow({ trailingPE: 20, fcfYieldPercent: 7 }));
    expect(b.earningsQuality).toBe(1);
  });

  it('−1 when FCF Yield < Earnings Yield by 1pp+', () => {
    const b = computeBreakdown(blankRow({ trailingPE: 20, fcfYieldPercent: 3 }));
    expect(b.earningsQuality).toBe(-1);
  });

  it('−1 when FCF is negative (red flag)', () => {
    const b = computeBreakdown(blankRow({ fcfYieldPercent: -2 }));
    expect(b.earningsQuality).toBe(-1);
  });

  // The EQ test is a conversion RATIO (FCF/NI = fcfYield × PE / 100), so the
  // threshold means the same thing at every valuation multiple. The old
  // absolute-pp yield gap disqualified cheap stocks (1pp = 8% shortfall at P/E 8)
  // while passing expensive ones (1pp = 50% shortfall at P/E 50).
  it('passes sound deep value: FCF/NI 0.88 at P/E 8 is 0, not −1', () => {
    const b = computeBreakdown(blankRow({ trailingPE: 8, fcfYieldPercent: 11 }));
    expect(b.earningsQuality).toBe(0);
  });

  it('fails expensive low conversion: FCF/NI 0.55 at P/E 50 is −1', () => {
    const b = computeBreakdown(blankRow({ trailingPE: 50, fcfYieldPercent: 1.1 }));
    expect(b.earningsQuality).toBe(-1);
  });

  it('+1 whenever conversion exceeds 1.0, even by a small margin', () => {
    // ratio = 5.2 × 20 / 100 = 1.04
    const b = computeBreakdown(blankRow({ trailingPE: 20, fcfYieldPercent: 5.2 }));
    expect(b.earningsQuality).toBe(1);
  });

  it('0 in the 0.7–1.0 conversion band', () => {
    // ratio = 4 × 20 / 100 = 0.8
    const b = computeBreakdown(blankRow({ trailingPE: 20, fcfYieldPercent: 4 }));
    expect(b.earningsQuality).toBe(0);
  });

  // Graduated eliminator: a binary cliff on one noisy TTM datapoint was below
  // institutional evidence standards. Only the unambiguous cases eliminate
  // (negative FCF, or conversion < 0.5); the 0.5–0.7 band costs Risk and caps
  // the tier at Moderate — an unresolved quality question, not proof of fraud.
  it('soft band (0.5–0.7): −1 risk, flagged, capped at moderate — NOT disqualified', () => {
    // conversion = 3 × 20 / 100 = 0.6; everything else strong (strength ≥ 12)
    const row = fullRow({ fcfYieldPercent: 3, evToEbitda: 10, marketCap: 5_000_000_000 });
    const scored = scoreRow(row);
    expect(scored.breakdown.earningsQuality).toBe(-1);
    expect(scored.flags.softEarningsQuality).toBe(true);
    expect(scored.flags.disqualified).toBe(false);
    expect(scored.tier).toBe('moderate'); // capped, not weak, not strong
  });

  it('critical band (< 0.5) still disqualifies', () => {
    // conversion = 2 × 20 / 100 = 0.4
    const row = fullRow({ fcfYieldPercent: 2 });
    const scored = scoreRow(row);
    expect(scored.flags.softEarningsQuality).toBe(false);
    expect(scored.flags.disqualified).toBe(true);
    expect(scored.tier).toBe('weak');
  });

  it('negative FCF still disqualifies (cash burn is unambiguous)', () => {
    const row = fullRow({ fcfYieldPercent: -3 });
    expect(scoreRow(row).flags.disqualified).toBe(true);
  });

  it('benign growth waiver suppresses the soft cap too', () => {
    // conversion 0.6 but FCF ≥ 2 and revenue surging → benign, no cap, no dq
    const row = fullRow({ fcfYieldPercent: 3, revenueGrowthTTM: 150, revenueGrowthQuarterly: 150 });
    const scored = scoreRow(row);
    expect(scored.flags.benignEarningsQuality).toBe(true);
    expect(scored.flags.softEarningsQuality).toBe(false);
    expect(scored.flags.disqualified).toBe(false);
  });

  // --- #2 Leverage (×3) ---
  it('+1 when D/E < 1.0', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: 0.5 }));
    expect(b.leverage).toBe(1);
  });

  it('−1 when D/E > 2.0', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: 3.0 }));
    expect(b.leverage).toBe(-1);
  });

  it('neutral (0) when D/E is negative (buyback-driven negative book equity)', () => {
    // e.g. McDonald's-style negative equity — the ratio is meaningless, not dangerous
    const b = computeBreakdown(blankRow({ debtToEquity: -4.2 }));
    expect(b.leverage).toBe(0);
  });

  it('neutral (0) when D/E is extremely high (buyback-shrunken equity base)', () => {
    // MCD reports a large positive D/E (~40) because equity is near zero, not because
    // debt is huge — neutralize rather than disqualify.
    expect(computeBreakdown(blankRow({ debtToEquity: 40.64 })).leverage).toBe(0);
  });

  it('still flags genuinely leveraged companies in the 2–10 band', () => {
    expect(computeBreakdown(blankRow({ debtToEquity: 4 })).leverage).toBe(-1);
  });

  it('neutral (0) on high D/E for a financial (leverage is structural)', () => {
    const b = computeBreakdown(blankRow({ industry: 'Financial Services', debtToEquity: 3.0 }));
    expect(b.leverage).toBe(0);
  });

  // When D/E is distorted (negative or > EXTREME_DE_RATIO), interest coverage
  // arbitrates: buyback-shrunken equity with easily-serviced debt stays neutral,
  // but loss-wiped equity that can't cover interest is fatal — the exact case
  // the blanket waiver used to hide.
  it('−1 when D/E is extreme AND interest coverage is weak (loss-wiped equity)', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: 12, interestCoverage: 1.2 }));
    expect(b.leverage).toBe(-1);
  });

  it('disqualifies extreme D/E with weak coverage (Tier 1 elimination)', () => {
    const row = blankRow({ debtToEquity: 12, interestCoverage: 1.2 });
    expect(isDisqualified(computeBreakdown(row), row)).toBe(true);
  });

  it('neutral when D/E is extreme but coverage is strong (MCD-style buybacks)', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: 40.64, interestCoverage: 8 }));
    expect(b.leverage).toBe(0);
  });

  it('−1 when D/E is negative AND coverage is weak', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: -4.2, interestCoverage: 1.0 }));
    expect(b.leverage).toBe(-1);
  });

  it('neutral when D/E is distorted and coverage is unavailable (cannot arbitrate)', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: 12, interestCoverage: null }));
    expect(b.leverage).toBe(0);
  });

  // Coverage-first: interest coverage (serviceability) arbitrates EVERY
  // leverage read, not just distorted ratios. D/E is the profession's least
  // reliable leverage metric; coverage answers the actual survival question.
  it('−1 when coverage is weak even at LOW D/E (cannot service the debt it has)', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: 0.8, interestCoverage: 1.5 }));
    expect(b.leverage).toBe(-1);
  });

  it('D/E > 2 with STRONG coverage keeps −1 risk but is waived from disqualification (DELL case)', () => {
    const row = blankRow({ debtToEquity: 2.5, interestCoverage: 12 });
    const scored = scoreRow(row);
    expect(scored.breakdown.leverage).toBe(-1);          // still costs Risk
    expect(scored.flags.serviceableLeverage).toBe(true); // but waived
    expect(scored.flags.disqualified).toBe(false);
  });

  it('D/E > 2 with middling coverage (2–6) still disqualifies (stretched borrower)', () => {
    const row = blankRow({ debtToEquity: 2.5, interestCoverage: 3 });
    expect(isDisqualified(computeBreakdown(row), row)).toBe(true);
  });

  it('D/E > 2 with NO coverage data still disqualifies (cannot verify serviceability)', () => {
    const row = blankRow({ debtToEquity: 3.0 });
    expect(isDisqualified(computeBreakdown(row), row)).toBe(true);
  });

  it('a DELL-shaped row (levered but serviceable, otherwise strong) can reach its earned tier', () => {
    const scored = scoreRow(fullRow({ debtToEquity: 2.4, interestCoverage: 11, marketCap: 5_000_000_000 }));
    expect(scored.flags.disqualified).toBe(false);
    expect(scored.riskScore).toBeGreaterThanOrEqual(3); // leverage risk stays visible
    expect(scored.tier).not.toBe('weak');
  });

  // --- #3 Revenue Growth (×2) ---
  it('+1 when revenue growth > 10%', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: 15 }));
    expect(b.revenueGrowth).toBe(1);
  });

  it('−1 when revenue growth < 0%', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: -5 }));
    expect(b.revenueGrowth).toBe(-1);
  });

  it('0 when revenue growth between 0 and 10%', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: 7 }));
    expect(b.revenueGrowth).toBe(0);
  });

  // Provider growth figures are not always trustworthy — verified live: Finnhub
  // returns revenueGrowthTTMYoy 108.98 for JPM, a clear artifact. Implausible
  // values are neutralized and flagged instead of scored.
  it('neutralizes implausible growth for a financial (>60%) — live JPM artifact', () => {
    const row = blankRow({ industry: 'Banks', revenueGrowthTTM: 108.98 });
    expect(computeBreakdown(row).revenueGrowth).toBe(0);
    expect(scoreRow(row).flags.suspectRevenueGrowth).toBe(true);
  });

  it('keeps plausible financial growth scored', () => {
    const row = blankRow({ industry: 'Banks', revenueGrowthTTM: 12 });
    expect(computeBreakdown(row).revenueGrowth).toBe(1);
    expect(scoreRow(row).flags.suspectRevenueGrowth).toBe(false);
  });

  it('neutralizes >300% growth for any industry (data artifact scale)', () => {
    const row = blankRow({ revenueGrowthTTM: 350 });
    expect(computeBreakdown(row).revenueGrowth).toBe(0);
    expect(scoreRow(row).flags.suspectRevenueGrowth).toBe(true);
  });

  it('keeps genuine hyper-growth scored for non-financials (MU-style 150%)', () => {
    const row = blankRow({ industry: 'Semiconductors', revenueGrowthTTM: 150 });
    expect(computeBreakdown(row).revenueGrowth).toBe(1);
    expect(scoreRow(row).flags.suspectRevenueGrowth).toBe(false);
  });

  it('flags a suspect QUARTERLY figure too (not silently swallowed)', () => {
    const row = blankRow({ revenueGrowthTTM: 12, revenueGrowthQuarterly: 350 });
    expect(scoreRow(row).flags.suspectRevenueGrowth).toBe(true);
    expect(criterionEvidence(row, 'revenueAcceleration')).toContain('implausible');
  });

  it('suspect growth never grants the benign-EQ waiver', () => {
    const row = blankRow({ trailingPE: 20, fcfYieldPercent: 2, revenueGrowthTTM: 350 });
    expect(isBenignEarningsQuality(row)).toBe(false);
    expect(isDisqualified(computeBreakdown(row), row)).toBe(true);
  });

  // --- Revenue Acceleration (×2): quarterly YoY vs TTM YoY ---
  // The screener used to see only growth LEVELS, so an accelerating business
  // scored identically to a static one and turnarounds were invisible.
  it('+1 when quarterly growth exceeds TTM growth by 3pp+', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: 12, revenueGrowthQuarterly: 18 }));
    expect(b.revenueAcceleration).toBe(1);
  });

  it('−1 when quarterly growth trails TTM growth by 3pp+ (decelerating)', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: 12, revenueGrowthQuarterly: 5 }));
    expect(b.revenueAcceleration).toBe(-1);
  });

  it('0 inside the ±3pp band (steady growth)', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: 12, revenueGrowthQuarterly: 13 }));
    expect(b.revenueAcceleration).toBe(0);
  });

  it('detects acceleration out of a decline (turnaround signature)', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: -2, revenueGrowthQuarterly: 4 }));
    expect(b.revenueAcceleration).toBe(1);
  });

  it('0 when either growth figure is missing', () => {
    expect(computeBreakdown(blankRow({ revenueGrowthTTM: 12 })).revenueAcceleration).toBe(0);
    expect(computeBreakdown(blankRow({ revenueGrowthQuarterly: 18 })).revenueAcceleration).toBe(0);
  });

  it('0 when either growth figure is implausible (same sanity bounds as level)', () => {
    expect(computeBreakdown(blankRow({ industry: 'Banks', revenueGrowthTTM: 108.98, revenueGrowthQuarterly: 5 })).revenueAcceleration).toBe(0);
    expect(computeBreakdown(blankRow({ revenueGrowthTTM: 12, revenueGrowthQuarterly: 350 })).revenueAcceleration).toBe(0);
  });

  // --- Margin Inflection (×2): TTM operating margin vs 5Y average ---
  it('+1 when TTM operating margin exceeds the 5Y average by 1pp+', () => {
    const b = computeBreakdown(blankRow({ operatingMarginTTM: 14, operatingMargin5Y: 11 }));
    expect(b.marginInflection).toBe(1);
  });

  it('−1 when TTM operating margin trails the 5Y average by 1pp+ (compressing)', () => {
    const b = computeBreakdown(blankRow({ operatingMarginTTM: 8, operatingMargin5Y: 11 }));
    expect(b.marginInflection).toBe(-1);
  });

  it('0 inside the ±1pp band (stable margins)', () => {
    const b = computeBreakdown(blankRow({ operatingMarginTTM: 11.5, operatingMargin5Y: 11 }));
    expect(b.marginInflection).toBe(0);
  });

  it('0 when either margin is missing', () => {
    expect(computeBreakdown(blankRow({ operatingMarginTTM: 14 })).marginInflection).toBe(0);
    expect(computeBreakdown(blankRow({ operatingMargin5Y: 11 })).marginInflection).toBe(0);
  });

  // --- #4 FCF Yield Level (×2) ---
  it('+1 when FCF yield > 5%', () => {
    const b = computeBreakdown(blankRow({ fcfYieldPercent: 7 }));
    expect(b.fcfYieldLevel).toBe(1);
  });

  it('−1 when FCF yield < 2%', () => {
    const b = computeBreakdown(blankRow({ fcfYieldPercent: 1.5 }));
    expect(b.fcfYieldLevel).toBe(-1);
  });

  it('0 when FCF yield between 2% and 5%', () => {
    const b = computeBreakdown(blankRow({ fcfYieldPercent: 3.5 }));
    expect(b.fcfYieldLevel).toBe(0);
  });

  // --- #5 P/E Compression (×2) ---
  it('+1 when forward PE < trailing PE', () => {
    const b = computeBreakdown(blankRow({ trailingPE: 20, forwardPE: 15 }));
    expect(b.peCompression).toBe(1);
  });

  it('−1 when forward PE > trailing PE', () => {
    const b = computeBreakdown(blankRow({ trailingPE: 15, forwardPE: 20 }));
    expect(b.peCompression).toBe(-1);
  });

  it('0 when forward PE == trailing PE', () => {
    const b = computeBreakdown(blankRow({ trailingPE: 15, forwardPE: 15 }));
    expect(b.peCompression).toBe(0);
  });

  it('neutralizes compression for cyclicals (semiconductors)', () => {
    // Big TTM→FWD compression that would be +1 for a non-cyclical
    const b = computeBreakdown(blankRow({ industry: 'Semiconductors', trailingPE: 50, forwardPE: 11 }));
    expect(b.peCompression).toBe(0);
  });

  it('neutralizes compression for automobiles', () => {
    const b = computeBreakdown(blankRow({ industry: 'Automobiles', trailingPE: 370, forwardPE: 200 }));
    expect(b.peCompression).toBe(0);
  });

  it('still penalizes a cyclical whose estimates are rolling over (fwd > TTM)', () => {
    // Asymmetric: expected cyclical EPS growth is never rewarded (+1 suppressed),
    // but expected decline is the honest peak signal and keeps its −1.
    const b = computeBreakdown(blankRow({ industry: 'Oil & Gas Exploration', trailingPE: 6, forwardPE: 9 }));
    expect(b.peCompression).toBe(-1);
  });

  // --- #6 Valuation EV/EBITDA (×1) ---
  it('+1 when EV/EBITDA < 15', () => {
    const b = computeBreakdown(blankRow({ evToEbitda: 10 }));
    expect(b.valuation).toBe(1);
  });

  it('−1 when EV/EBITDA > 25', () => {
    const b = computeBreakdown(blankRow({ evToEbitda: 30 }));
    expect(b.valuation).toBe(-1);
  });

  // --- #7 Dividend Coverage (×1) ---
  it('+1 when FCF Yield > Div Yield (covered)', () => {
    const b = computeBreakdown(blankRow({ fcfYieldPercent: 6, dividendYieldPercent: 3 }));
    expect(b.dividendCoverage).toBe(1);
  });

  it('−1 when FCF Yield < Div Yield (not covered)', () => {
    const b = computeBreakdown(blankRow({ fcfYieldPercent: 2, dividendYieldPercent: 4 }));
    expect(b.dividendCoverage).toBe(-1);
  });

  it('0 for non-dividend payer', () => {
    const b = computeBreakdown(blankRow({ fcfYieldPercent: 6, dividendYieldPercent: 0 }));
    expect(b.dividendCoverage).toBe(0);
  });

  // --- #8 52W Position (×1) ---
  it('+1 when range position < 0.4', () => {
    const b = computeBreakdown(blankRow({ rangePosition: 0.3 }));
    expect(b.pricePosition).toBe(1);
  });

  it('−1 when range position > 0.9', () => {
    const b = computeBreakdown(blankRow({ rangePosition: 0.95 }));
    expect(b.pricePosition).toBe(-1);
  });

  // --- #9 YTD Momentum (×1) ---
  it('+1 when YTD > 0', () => {
    const b = computeBreakdown(blankRow({ ytdReturn: 12 }));
    expect(b.ytdMomentum).toBe(1);
  });

  it('−1 when YTD < 0', () => {
    const b = computeBreakdown(blankRow({ ytdReturn: -5 }));
    expect(b.ytdMomentum).toBe(-1);
  });

  // --- #10 Dividend Yield (×1) ---
  it('+1 when div yield > 1.5%', () => {
    const b = computeBreakdown(blankRow({ dividendYieldPercent: 2.5 }));
    expect(b.dividendYield).toBe(1);
  });

  it('0 for non-payer', () => {
    const b = computeBreakdown(blankRow({ dividendYieldPercent: 0 }));
    expect(b.dividendYield).toBe(0);
  });
});

describe('financial neutralization (FCF-derived criteria are noise for banks/insurers)', () => {
  // P/FCF-derived FCF yield is economically meaningless for financials —
  // verified live: Finnhub returns JPM pfcfShareTTM 5.98 (a 16.7% "FCF yield").
  // Only D/E used to be neutralized; the FCF criteria scored the noise.
  const bank = () => blankRow({
    industry: 'Banks', trailingPE: 11, fcfYieldPercent: 30,
    dividendYieldPercent: 3, evToEbitda: 9,
  });

  it('neutralizes earnings quality for financials', () => {
    expect(computeBreakdown(bank()).earningsQuality).toBe(0);
  });

  it('neutralizes FCF yield level for financials', () => {
    expect(computeBreakdown(bank()).fcfYieldLevel).toBe(0);
  });

  it('neutralizes dividend coverage for financials', () => {
    expect(computeBreakdown(bank()).dividendCoverage).toBe(0);
  });

  it('neutralizes EV/EBITDA valuation for financials (not meaningful for banks)', () => {
    expect(computeBreakdown(bank()).valuation).toBe(0);
  });

  it('does not treat negative FCF as a red flag for a financial (still noise)', () => {
    expect(computeBreakdown(blankRow({ industry: 'Insurance', fcfYieldPercent: -5 })).earningsQuality).toBe(0);
  });

  it('still scores P/E-based and price criteria for financials', () => {
    const b = computeBreakdown(blankRow({ industry: 'Banks', trailingPE: 11, forwardPE: 10, dividendYieldPercent: 3, ytdReturn: 6 }));
    expect(b.peCompression).toBe(1);
    expect(b.dividendYield).toBe(1);
    expect(b.ytdMomentum).toBe(1);
  });
});

describe('REIT leverage neutralization', () => {
  it('does not flag structurally normal REIT leverage (D/E 2.5)', () => {
    const row = blankRow({ industry: 'Real Estate Investment Trusts', debtToEquity: 2.5 });
    const b = computeBreakdown(row);
    expect(b.leverage).toBe(0);
    expect(isDisqualified(b, row)).toBe(false);
  });

  it('matches bare "REIT" industry labels', () => {
    expect(computeBreakdown(blankRow({ industry: 'Equity REITs', debtToEquity: 2.5 })).leverage).toBe(0);
  });

  it('keeps FCF-derived criteria scored for REITs (unlike financials)', () => {
    const b = computeBreakdown(blankRow({ industry: 'Real Estate Investment Trusts', fcfYieldPercent: 6 }));
    expect(b.fcfYieldLevel).toBe(1);
  });
});

describe('industry classification helpers', () => {
  it('detects cyclical industries', () => {
    expect(isCyclicalIndustry('Semiconductors')).toBe(true);
    expect(isCyclicalIndustry('Automobiles')).toBe(true);
    expect(isCyclicalIndustry('Software')).toBe(false);
    expect(isCyclicalIndustry(null)).toBe(false);
  });

  it('detects the broader commodity/deep-cyclical set', () => {
    // The old list was semis + autos only, so an oil producer at peak earnings
    // scored Strong 14/17 with no cyclical treatment at all.
    for (const industry of [
      'Oil & Gas Exploration', 'Oil, Gas & Consumable Fuels', 'Energy Equipment & Services',
      'Metals & Mining', 'Steel', 'Chemicals', 'Marine', 'Airlines',
      'Construction Materials', 'Building Products', 'Paper & Forest Products',
    ]) {
      expect(isCyclicalIndustry(industry), industry).toBe(true);
    }
  });

  it('does not over-match defensives and financials as cyclical', () => {
    for (const industry of ['Banks', 'Insurance', 'Beverages', 'Pharmaceuticals', 'Electric Utilities', 'Software']) {
      expect(isCyclicalIndustry(industry), industry).toBe(false);
    }
  });

  it('detects financial industries', () => {
    expect(isFinancialIndustry('Financial Services')).toBe(true);
    expect(isFinancialIndustry('Banks')).toBe(true);
    expect(isFinancialIndustry('Insurance')).toBe(true);
    expect(isFinancialIndustry('Technology')).toBe(false);
    expect(isFinancialIndustry(null)).toBe(false);
  });
});

describe('classifyFinancialModel (Phase 5, ticker-aware)', () => {
  it('gates balance-sheet / spread financials', () => {
    // Regex-matched via label:
    for (const [t, ind] of [['JPM', 'Banks'], ['BAC', 'Banks'], ['MET', 'Insurance—Life'],
      ['SCHW', 'Capital Markets'], ['IBKR', 'Capital Markets'], ['HOOD', 'Financial Services']] as const) {
      expect(classifyFinancialModel(t, ind), t).toBe('balance-sheet');
      expect(isBalanceSheetFinancial(t, ind), t).toBe(true);
    }
    // Curated overrides for card lenders the regex misses ("Credit Services"):
    for (const t of ['COF', 'DFS', 'AXP', 'SYF', 'ALLY']) {
      expect(classifyFinancialModel(t, 'Credit Services'), t).toBe('balance-sheet');
    }
  });

  it('does NOT gate asset-light financial-adjacent names (real DCF-able FCF)', () => {
    const cases: [string, string][] = [
      ['BLK', 'Asset Management'], ['TROW', 'Asset Management'],
      ['CME', 'Financial Data & Stock Exchanges'], ['ICE', 'Financial Data & Stock Exchanges'],
      ['NDAQ', 'Financial Data & Stock Exchanges'], ['CBOE', 'Financial Data & Stock Exchanges'],
      ['SPGI', 'Financial Data & Stock Exchanges'], ['MCO', 'Financial Data & Stock Exchanges'],
      ['MSCI', 'Financial Data & Stock Exchanges'], ['V', 'Credit Services'], ['MA', 'Credit Services'],
    ];
    for (const [t, ind] of cases) {
      expect(classifyFinancialModel(t, ind), t).toBe('asset-light');
      expect(isBalanceSheetFinancial(t, ind), t).toBe(false);
    }
  });

  it('non-financials and unknown labels are non-financial', () => {
    expect(classifyFinancialModel('AAPL', 'Technology')).toBe('non-financial');
    expect(classifyFinancialModel('XOM', 'Oil & Gas Integrated')).toBe('non-financial');
    expect(isBalanceSheetFinancial('AAPL', 'Technology')).toBe(false);
  });

  it('isBalanceSheetFinancial predicate (the shared scoring + DCF-gate boundary Phase 4 relies on)', () => {
    for (const t of ['COF', 'DFS', 'AXP', 'SYF', 'ALLY']) {
      expect(isBalanceSheetFinancial(t, 'Credit Services'), t).toBe(true);
    }
    const notGated: [string, string][] = [
      ['V', 'Credit Services'], ['MA', 'Credit Services'],
      ['SPGI', 'Financial Data & Stock Exchanges'], ['CME', 'Financial Data & Stock Exchanges'],
      ['ICE', 'Financial Data & Stock Exchanges'], ['NDAQ', 'Financial Data & Stock Exchanges'],
      ['BLK', 'Asset Management'], ['TROW', 'Asset Management'],
    ];
    for (const [t, ind] of notGated) {
      expect(isBalanceSheetFinancial(t, ind), t).toBe(false);
    }
  });

  it('changes neutralization: COF now gated, SPGI now scored (SCORING_VERSION bump)', () => {
    // COF (override → balance-sheet): FCF-derived criteria neutralized to 0.
    const cof = computeBreakdown(blankRow({ ticker: 'COF', industry: 'Credit Services', fcfYieldPercent: 6, trailingPE: 10 }));
    expect(cof.fcfYieldLevel).toBe(0);
    expect(cof.earningsQuality).toBe(0);
    // SPGI (override → asset-light): FCF-derived criteria SCORED (was neutralized pre-Phase-5).
    const spgi = computeBreakdown(blankRow({ ticker: 'SPGI', industry: 'Financial Data & Stock Exchanges', fcfYieldPercent: 6, trailingPE: 10 }));
    expect(spgi.fcfYieldLevel).toBe(1); // 6% > 5% → +1, no longer neutralized
  });
});

describe('computeScores (split strength / risk)', () => {
  it('strength sums only positive weighted signals', () => {
    const breakdown: ScoreBreakdown = {
      earningsQuality: 1,     // ×3 = +3
      leverage: 1,            // ×3 = +3
      revenueGrowth: 1,       // ×2 = +2
      revenueAcceleration: 0,
      fcfYieldLevel: 1,       // ×2 = +2
      marginInflection: 0,
      peCompression: -1,      // ×2 = -2 (→ risk)
      valuation: 1,           // ×1 = +1
      dividendCoverage: 0,
      pricePosition: -1,      // ×1 = -1 (→ risk)
      ytdMomentum: -1,        // ×1 = -1 (→ risk)
      dividendYield: 0,
    };
    const { strength, risk } = computeScores(breakdown);
    expect(strength).toBe(11); // 3+3+2+2+1
    expect(risk).toBe(4);      // 2+1+1
    expect(totalScore(breakdown)).toBe(7); // strength − risk
  });

  it('max strength is +21', () => {
    const all: ScoreBreakdown = {
      earningsQuality: 1, leverage: 1, revenueGrowth: 1, revenueAcceleration: 1,
      fcfYieldLevel: 1, marginInflection: 1, peCompression: 1, valuation: 1,
      dividendCoverage: 1, pricePosition: 1, ytdMomentum: 1, dividendYield: 1,
    };
    expect(computeScores(all).strength).toBe(21);
    expect(computeScores(all).risk).toBe(0);
  });

  it('max risk is 20 (dividendYield never negative)', () => {
    const all: ScoreBreakdown = {
      earningsQuality: -1, leverage: -1, revenueGrowth: -1, revenueAcceleration: -1,
      fcfYieldLevel: -1, marginInflection: -1, peCompression: -1, valuation: -1,
      dividendCoverage: -1, pricePosition: -1, ytdMomentum: -1, dividendYield: 0,
    };
    expect(computeScores(all).risk).toBe(20);
    expect(computeScores(all).strength).toBe(0);
  });

  it('weights are correct per tier', () => {
    expect(CRITERION_WEIGHT.earningsQuality).toBe(3);
    expect(CRITERION_WEIGHT.leverage).toBe(3);
    expect(CRITERION_WEIGHT.revenueGrowth).toBe(2);
    expect(CRITERION_WEIGHT.revenueAcceleration).toBe(2);
    expect(CRITERION_WEIGHT.fcfYieldLevel).toBe(2);
    expect(CRITERION_WEIGHT.marginInflection).toBe(2);
    expect(CRITERION_WEIGHT.peCompression).toBe(2);
    expect(CRITERION_WEIGHT.valuation).toBe(1);
    expect(CRITERION_WEIGHT.dividendCoverage).toBe(1);
    expect(CRITERION_WEIGHT.pricePosition).toBe(1);
    expect(CRITERION_WEIGHT.ytdMomentum).toBe(1);
    expect(CRITERION_WEIGHT.dividendYield).toBe(1);
  });
});

describe('isDisqualified (hard floor rule)', () => {
  it('disqualified when Earnings Quality is critically −1 (conversion < 0.5)', () => {
    const row = blankRow({ trailingPE: 20, fcfYieldPercent: 2 }); // conversion 0.4
    const b = computeBreakdown(row);
    expect(b.earningsQuality).toBe(-1);
    expect(isDisqualified(b, row)).toBe(true);
  });

  it('NOT disqualified in the soft EQ band (conversion 0.5–0.7) — capped instead', () => {
    const row = blankRow({ trailingPE: 20, fcfYieldPercent: 3 }); // conversion 0.6
    const b = computeBreakdown(row);
    expect(b.earningsQuality).toBe(-1);
    expect(isDisqualified(b, row)).toBe(false);
  });

  it('disqualified when Leverage is −1', () => {
    const row = blankRow({ debtToEquity: 3.0 });
    const b = computeBreakdown(row);
    expect(b.leverage).toBe(-1);
    expect(isDisqualified(b, row)).toBe(true);
  });

  it('not disqualified when a financial has high D/E (leverage neutralized)', () => {
    const row = blankRow({ industry: 'Financial Services', debtToEquity: 3.0 });
    expect(isDisqualified(computeBreakdown(row), row)).toBe(false);
  });

  it('not disqualified when both are +1', () => {
    const row = blankRow({ trailingPE: 20, fcfYieldPercent: 7, debtToEquity: 0.5 });
    expect(isDisqualified(computeBreakdown(row), row)).toBe(false);
  });
});

describe('benign Earnings Quality carve-out', () => {
  it('is benign when FCF is positive (≥2%) and revenue is surging (>20%)', () => {
    expect(isBenignEarningsQuality(blankRow({ fcfYieldPercent: 2.7, revenueGrowthTTM: 150 }))).toBe(true);
  });

  it('is NOT benign when FCF is weak (<2%) even with surging revenue', () => {
    // e.g. MU on the stale 0.85% trailing FCF — caution still warranted
    expect(isBenignEarningsQuality(blankRow({ fcfYieldPercent: 0.85, revenueGrowthTTM: 150 }))).toBe(false);
  });

  it('is NOT benign when growth is ordinary (≤20%)', () => {
    expect(isBenignEarningsQuality(blankRow({ fcfYieldPercent: 4, revenueGrowthTTM: 12 }))).toBe(false);
  });

  it('waives the EQ disqualifier when benign, but keeps it otherwise', () => {
    // EQ = −1 (conversion 0.6), but FCF≥2 and revenue +150% → benign → not disqualified
    const benign = blankRow({ trailingPE: 20, fcfYieldPercent: 3, revenueGrowthTTM: 150 });
    const bb = computeBreakdown(benign);
    expect(bb.earningsQuality).toBe(-1);
    expect(isDisqualified(bb, benign)).toBe(false);

    // Critical conversion (0.4) with ordinary growth → still disqualified
    const harsh = blankRow({ trailingPE: 20, fcfYieldPercent: 2, revenueGrowthTTM: 5 });
    expect(isDisqualified(computeBreakdown(harsh), harsh)).toBe(true);
  });

  it('never benign when FCF is negative (cash burn protection intact)', () => {
    expect(isBenignEarningsQuality(blankRow({ fcfYieldPercent: -2, revenueGrowthTTM: 150 }))).toBe(false);
  });
});

describe('isCrowded (mega-cap near 52W high)', () => {
  it('true for a mega-cap in the top 10% of its range', () => {
    expect(isCrowded(blankRow({ marketCap: MEGA_CAP_THRESHOLD, rangePosition: 0.95 }))).toBe(true);
  });

  it('false for a mega-cap lower in its range', () => {
    expect(isCrowded(blankRow({ marketCap: 4_000_000_000_000, rangePosition: 0.5 }))).toBe(false);
  });

  it('false for a small-cap near its high', () => {
    expect(isCrowded(blankRow({ marketCap: 5_000_000_000, rangePosition: 0.98 }))).toBe(false);
  });
});

describe('value-trap gate (cheap + shrinking cannot rank Strong)', () => {
  // A falling price simultaneously improves FCF yield, EV/EBITDA, dividend
  // coverage, and 52W position, while decline shows up in exactly one −2
  // signal — so a melting ice cube with good cash conversion used to score
  // Strength 14/17 → STRONG. Cheap + shrinking now caps the tier at Moderate.
  const trap = () => blankRow({
    industry: 'Media Agencies', trailingPE: 7, forwardPE: 6.5, fcfYieldPercent: 16,
    revenueGrowthTTM: -6, debtToEquity: 0.9, interestCoverage: 7, evToEbitda: 4.5,
    dividendYieldPercent: 6, rangePosition: 0.15, ytdReturn: -25,
  });

  it('flags the trap archetype and caps it at moderate', () => {
    const scored = scoreRow(trap());
    expect(scored.flags.valueTrap).toBe(true);
    expect(scored.strengthScore).toBeGreaterThanOrEqual(12); // would be strong…
    expect(scored.tier).toBe('moderate');                    // …but capped
  });

  it('does not flag sound deep value (revenue still growing)', () => {
    const scored = scoreRow({ ...trap(), revenueGrowthTTM: 2 });
    expect(scored.flags.valueTrap).toBe(false);
    expect(scored.tier).toBe('strong'); // same cheapness, growing → uncapped
  });

  it('does not flag a declining business that is not optically cheap', () => {
    const scored = scoreRow(blankRow({ revenueGrowthTTM: -5, evToEbitda: 12, fcfYieldPercent: 4 }));
    expect(scored.flags.valueTrap).toBe(false);
  });

  it('never flags financials — their FCF/EV "cheapness" is the same neutralized noise', () => {
    // A bank with P/FCF-noise FCF yield (the live JPM case) and mildly declining
    // revenue must not be labeled a value trap off data the scorer refuses to score.
    const scored = scoreRow(blankRow({ industry: 'Banks', fcfYieldPercent: 30, evToEbitda: 5, revenueGrowthTTM: -2 }));
    expect(scored.flags.valueTrap).toBe(false);
  });
});

describe('peak-cycle gate (cyclical, cheap on trailing, estimates falling)', () => {
  // The classic cyclical trap: trailing numbers look phenomenal exactly at the
  // top (low P/E, huge FCF yield, low EV/EBITDA, booming growth) while forward
  // estimates are already rolling over. Used to score STRONG 14/17.
  const peak = () => blankRow({
    industry: 'Oil & Gas Exploration', trailingPE: 6, forwardPE: 9, fcfYieldPercent: 18,
    revenueGrowthTTM: 30, debtToEquity: 0.4, interestCoverage: 20, evToEbitda: 3.5,
    dividendYieldPercent: 3, rangePosition: 0.85, ytdReturn: 20,
  });

  it('flags the peak archetype and caps it at moderate', () => {
    const scored = scoreRow(peak());
    expect(scored.flags.peakCycle).toBe(true);
    expect(scored.tier).not.toBe('strong');
  });

  it('does not flag a cyclical whose estimates still point up', () => {
    const scored = scoreRow({ ...peak(), forwardPE: 5 });
    expect(scored.flags.peakCycle).toBe(false);
  });

  it('does not flag an expensive cyclical (nothing optically cheap to trap on)', () => {
    const scored = scoreRow(blankRow({ industry: 'Semiconductors', trailingPE: 30, forwardPE: 35, evToEbitda: 20, fcfYieldPercent: 3 }));
    expect(scored.flags.peakCycle).toBe(false);
  });

  it('does not flag non-cyclicals', () => {
    const scored = scoreRow(blankRow({ industry: 'Software', trailingPE: 6, forwardPE: 9, evToEbitda: 4, fcfYieldPercent: 18 }));
    expect(scored.flags.peakCycle).toBe(false);
  });
});

describe('improvement detection (turnaround / pre-recognition)', () => {
  it('lifts a turnaround with accelerating revenue and inflecting margins to moderate', () => {
    // Losses ending (no trailing P/E), estimates positive, growth turning up,
    // margins above the 5Y average — used to score Weak 3/17, invisible.
    const scored = scoreRow(blankRow({
      trailingPE: null, forwardPE: 15, fcfYieldPercent: 2.5, revenueGrowthTTM: -2,
      revenueGrowthQuarterly: 4, operatingMarginTTM: 6, operatingMargin5Y: 3,
      debtToEquity: 1.5, interestCoverage: 4, evToEbitda: 12, dividendYieldPercent: 0,
      rangePosition: 0.35, ytdReturn: 15,
    }));
    expect(scored.breakdown.revenueAcceleration).toBe(1);
    expect(scored.breakdown.marginInflection).toBe(1);
    expect(scored.tier).toBe('moderate');
  });

  it('ranks an inflecting business above its static twin', () => {
    const base = {
      trailingPE: 21, forwardPE: 17, fcfYieldPercent: 4.5, revenueGrowthTTM: 12,
      debtToEquity: 0.7, interestCoverage: 12, evToEbitda: 13, dividendYieldPercent: 0.5,
      rangePosition: 0.45, ytdReturn: 3,
    };
    const staticTwin = scoreRow(blankRow({ ...base, revenueGrowthQuarterly: 12, operatingMarginTTM: 11, operatingMargin5Y: 11 }));
    const inflecting = scoreRow(blankRow({ ...base, revenueGrowthQuarterly: 18, operatingMarginTTM: 14, operatingMargin5Y: 11 }));
    expect(inflecting.strengthScore).toBe(staticTwin.strengthScore + 4);
  });
});

describe('computeCoverage + minimum-data floor', () => {
  // A null input can never score −1, so sparse rows used to look SAFER than
  // covered ones (an Alpha Vantage failover row cannot be disqualified at all).
  // Coverage measures how much of the scorecard actually had data; below the
  // floor a row cannot tier above weak, and the flag says why.
  it('counts 12/12 for a fully-populated non-financial row', () => {
    const c = computeCoverage(fullRow());
    expect(c.covered).toBe(12);
    expect(c.applicable).toBe(12);
    expect(c.fraction).toBe(1);
  });

  it('keeps peCompression applicable for cyclicals (asymmetric: −1 still scores)', () => {
    const c = computeCoverage(fullRow({ industry: 'Semiconductors' }));
    expect(c.applicable).toBe(12);
    expect(c.covered).toBe(12);
  });

  it('excludes the five neutralized criteria for financials', () => {
    // EQ, leverage, FCF level, dividend coverage, valuation are all neutralized.
    const c = computeCoverage(fullRow({ industry: 'Banks' }));
    expect(c.applicable).toBe(7);
    expect(c.covered).toBe(7);
  });

  it('counts suspect revenue growth as uncovered (level AND acceleration)', () => {
    const c = computeCoverage(fullRow({ revenueGrowthTTM: 350 }));
    expect(c.covered).toBe(10); // revenueGrowth + revenueAcceleration both uncovered
  });

  it('flags an AV-failover-shaped row as insufficient and floors it to weak', () => {
    // Alpha Vantage supplies no fcf/rev/de/ev/ytd — 3/10 coverage.
    const row = blankRow({ trailingPE: 14, forwardPE: 12, dividendYieldPercent: 2.5, rangePosition: 0.5 });
    const scored = scoreRow(row);
    expect(scored.coverage.fraction).toBeLessThan(0.7);
    expect(scored.flags.insufficientData).toBe(true);
    expect(scored.tier).toBe('weak');
  });

  it('missing D/E alone makes a non-financial insufficient (leverage unverifiable)', () => {
    const scored = scoreRow(fullRow({ debtToEquity: null }));
    expect(scored.coverage.fraction).toBeGreaterThanOrEqual(0.7);
    expect(scored.flags.insufficientData).toBe(true);
    expect(scored.tier).toBe('weak');
  });

  it('missing FCF alone makes a non-financial insufficient (cash conversion unverifiable)', () => {
    const scored = scoreRow(fullRow({ fcfYieldPercent: null }));
    expect(scored.flags.insufficientData).toBe(true);
  });

  it('does not require D/E or FCF for financials (not applicable to them)', () => {
    const row = blankRow({
      industry: 'Banks', trailingPE: 11, forwardPE: 10, revenueGrowthTTM: 12,
      dividendYieldPercent: 3, rangePosition: 0.5, ytdReturn: 6,
    });
    const scored = scoreRow(row);
    expect(scored.flags.insufficientData).toBe(false);
  });

  it('a fully-covered strong row keeps its tier', () => {
    const scored = scoreRow(fullRow({ marketCap: 5_000_000_000 }));
    expect(scored.flags.insufficientData).toBe(false);
    expect(scored.tier).toBe('strong');
  });
});

describe('tierFor (neutral signal tiers)', () => {
  it('weak when data coverage is insufficient, regardless of strength', () => {
    expect(tierFor(15, 0, { ...NO_FLAGS, insufficientData: true })).toBe('weak');
  });

  it('strong for strength >= 12 with low risk and no flags', () => {
    expect(tierFor(12, 0, NO_FLAGS)).toBe('strong');
    expect(tierFor(17, 2, NO_FLAGS)).toBe('strong');
  });

  it('moderate for strength 7–11', () => {
    expect(tierFor(7, 0, NO_FLAGS)).toBe('moderate');
    expect(tierFor(11, 4, NO_FLAGS)).toBe('moderate');
  });

  it('weak for strength < 7', () => {
    expect(tierFor(6, 0, NO_FLAGS)).toBe('weak');
    expect(tierFor(0, 0, NO_FLAGS)).toBe('weak');
  });

  it('weak when disqualified even with high strength', () => {
    expect(tierFor(15, 3, { ...NO_FLAGS, disqualified: true })).toBe('weak');
  });

  it('weak when risk >= 8 (hard floor) even with high strength', () => {
    expect(tierFor(14, 8, NO_FLAGS)).toBe('weak');
  });

  it('crowding caps an otherwise-strong stock at moderate', () => {
    expect(tierFor(15, 2, { ...NO_FLAGS, crowding: true })).toBe('moderate');
  });

  it('a value-trap flag caps an otherwise-strong stock at moderate', () => {
    expect(tierFor(14, 3, { ...NO_FLAGS, valueTrap: true })).toBe('moderate');
  });

  it('a peak-cycle flag caps an otherwise-strong stock at moderate', () => {
    expect(tierFor(14, 2, { ...NO_FLAGS, peakCycle: true })).toBe('moderate');
  });

  it('a soft-EQ flag caps an otherwise-strong stock at moderate', () => {
    expect(tierFor(14, 3, { ...NO_FLAGS, softEarningsQuality: true })).toBe('moderate');
  });

  it('serviceable leverage does NOT cap — risk points only', () => {
    expect(tierFor(14, 3, { ...NO_FLAGS, serviceableLeverage: true })).toBe('strong');
  });
});

describe('scoreRow', () => {
  it('returns a strong signal for a high-quality row', () => {
    const row = blankRow({
      industry: 'Software',
      marketCap: 5_000_000_000,
      trailingPE: 20,
      forwardPE: 12,
      fcfYieldPercent: 8,
      revenueGrowthTTM: 15,
      debtToEquity: 0.5,
      evToEbitda: 10,
      rangePosition: 0.3,
      ytdReturn: 10,
      dividendYieldPercent: 3,
    });
    const result = scoreRow(row);
    expect(result.strengthScore).toBe(17);
    expect(result.riskScore).toBe(0);
    expect(result.tier).toBe('strong');
    expect(result.flags.disqualified).toBe(false);
  });

  it('handles all-null metrics gracefully', () => {
    const result = scoreRow(blankRow());
    expect(result.strengthScore).toBe(0);
    expect(result.riskScore).toBe(0);
    expect(result.tier).toBe('weak');
    expect(result.flags.disqualified).toBe(false);
  });

  it('forces weak when Earnings Quality fails critically despite strong fundamentals', () => {
    const row = blankRow({
      trailingPE: 20,
      forwardPE: 12,
      fcfYieldPercent: 2,   // conversion 0.4 < 0.5 → critical → disqualified
      revenueGrowthTTM: 15,
      debtToEquity: 0.5,
      evToEbitda: 10,
      rangePosition: 0.3,
      ytdReturn: 10,
      dividendYieldPercent: 2,
    });
    const result = scoreRow(row);
    expect(result.flags.disqualified).toBe(true);
    expect(result.tier).toBe('weak');
  });

  it('does not penalize a buyback-heavy compounder for negative book equity', () => {
    // MCD-style: negative D/E, strong cash flows, modest growth
    const row = blankRow({
      industry: 'Hotels, Restaurants & Leisure',
      marketCap: 190_000_000_000,
      trailingPE: 22,
      forwardPE: 20,
      fcfYieldPercent: 5.5,
      revenueGrowthTTM: 5,
      debtToEquity: -8,        // negative equity from buybacks
      evToEbitda: 16,
      rangePosition: 0.1,
      ytdReturn: -11,
      dividendYieldPercent: 2.75,
    });
    const result = scoreRow(row);
    expect(result.breakdown.leverage).toBe(0);     // neutralized, not −1
    expect(result.flags.disqualified).toBe(false); // not a Tier 1 elimination
  });

  it('does not disqualify MCD for its real (extreme positive) D/E of 40.64', () => {
    const row = blankRow({
      industry: 'Hotels, Restaurants & Leisure',
      marketCap: 193_000_000_000,
      trailingPE: 22.3,
      forwardPE: 20.71,
      fcfYieldPercent: 3.64,
      revenueGrowthTTM: 6.77,
      debtToEquity: 40.64,     // real MCD value — equity shrunk by buybacks
      evToEbitda: 17.66,
      rangePosition: 0.07,
      ytdReturn: -11.11,
      dividendYieldPercent: 2.74,
    });
    const result = scoreRow(row);
    expect(result.breakdown.leverage).toBe(0);     // neutralized, not −1
    expect(result.flags.disqualified).toBe(false); // no longer a false Tier 1 elimination
  });

  it('does not disqualify MU on fresh data — EQ −1 is a benign growth drag → Moderate', () => {
    // MU post-Q3 FY26: huge revenue growth, strong (if trailing-lagging) FCF,
    // fortress balance sheet. EQ still −1 (FCF < earnings yield) but waived.
    const row = blankRow({
      industry: 'Semiconductors',
      marketCap: 1_150_000_000_000,
      trailingPE: 23,
      forwardPE: 8,
      fcfYieldPercent: 2.7,      // ≥2 → not weak
      revenueGrowthTTM: 150,     // >20 → surging
      debtToEquity: 0.057,
      evToEbitda: 17,
      rangePosition: 0.82,
      ytdReturn: 268,
      dividendYieldPercent: 0.06,
    });
    const result = scoreRow(row);
    expect(result.breakdown.earningsQuality).toBe(-1);       // still scores −1 (costs Risk)
    expect(result.flags.benignEarningsQuality).toBe(true);   // but waived
    expect(result.flags.disqualified).toBe(false);
    expect(result.tier).toBe('moderate');                    // no longer force-floored to weak
  });

  it('flags a cyclical near its highs and neutralizes its compression', () => {
    // MU-style: huge compression off peak earnings, extended price
    const row = blankRow({
      industry: 'Semiconductors',
      marketCap: 1_000_000_000_000,
      trailingPE: 50,
      forwardPE: 11,
      rangePosition: 0.95,
      ytdReturn: 300,
    });
    const result = scoreRow(row);
    expect(result.flags.cyclical).toBe(true);
    expect(result.breakdown.peCompression).toBe(0); // not rewarded as growth
    expect(result.flags.crowding).toBe(true);       // mega-cap near high
  });
});

describe('criterionEvidence', () => {
  it('shows the FCF/NI conversion ratio for earnings quality', () => {
    expect(criterionEvidence(blankRow({ trailingPE: 20, fcfYieldPercent: 7 }), 'earningsQuality'))
      .toBe('FCF/NI 1.40 (FCF 7.00% vs EY 5.00%)');
  });

  it('shows the D/E ratio for leverage', () => {
    expect(criterionEvidence(blankRow({ debtToEquity: 0.8 }), 'leverage')).toBe('D/E 0.80');
  });

  it('annotates neutralized leverage for financials', () => {
    expect(criterionEvidence(blankRow({ industry: 'Financial Services', debtToEquity: 3 }), 'leverage'))
      .toContain('financial — neutralized');
  });

  it('annotates neutralized leverage for negative book equity', () => {
    expect(criterionEvidence(blankRow({ debtToEquity: -4 }), 'leverage')).toContain('neg. equity — neutralized');
  });

  it('annotates neutralized leverage for an extreme positive D/E', () => {
    expect(criterionEvidence(blankRow({ debtToEquity: 40.64 }), 'leverage')).toContain('buyback-distorted — neutralized');
  });

  it('shows Fwd vs TTM for P/E compression, with cyclical note', () => {
    expect(criterionEvidence(blankRow({ trailingPE: 20, forwardPE: 15 }), 'peCompression'))
      .toBe('Fwd 15.00 vs TTM 20.00');
    expect(criterionEvidence(blankRow({ industry: 'Semiconductors', trailingPE: 50, forwardPE: 11 }), 'peCompression'))
      .toContain('cyclical — neutralized');
  });

  it('shows revenue growth, FCF level, valuation, position, YTD, yield', () => {
    expect(criterionEvidence(blankRow({ revenueGrowthTTM: 12.8 }), 'revenueGrowth')).toBe('+12.80% YoY');
    expect(criterionEvidence(blankRow({ fcfYieldPercent: 7 }), 'fcfYieldLevel')).toBe('7.00%');
    expect(criterionEvidence(blankRow({ evToEbitda: 10 }), 'valuation')).toBe('EV/EBITDA 10.00');
    expect(criterionEvidence(blankRow({ rangePosition: 0.3 }), 'pricePosition')).toBe('30% of range');
    expect(criterionEvidence(blankRow({ ytdReturn: 10 }), 'ytdMomentum')).toBe('+10.00% YTD');
    expect(criterionEvidence(blankRow({ dividendYieldPercent: 3 }), 'dividendYield')).toBe('3.00%');
  });

  it('handles dividend coverage and non-payers', () => {
    expect(criterionEvidence(blankRow({ fcfYieldPercent: 6, dividendYieldPercent: 3 }), 'dividendCoverage'))
      .toBe('FCF 6.00% vs Div 3.00%');
    expect(criterionEvidence(blankRow({ dividendYieldPercent: 0 }), 'dividendCoverage')).toBe('no dividend');
    expect(criterionEvidence(blankRow({ dividendYieldPercent: 0 }), 'dividendYield')).toBe('no dividend');
  });

  it('says "no data" when inputs are missing', () => {
    const r = blankRow();
    expect(criterionEvidence(r, 'earningsQuality')).toBe('no data');
    expect(criterionEvidence(r, 'revenueGrowth')).toBe('no data');
    expect(criterionEvidence(r, 'valuation')).toBe('no data');
    expect(criterionEvidence(r, 'peCompression')).toBe('no data');
  });
});

describe('CRITERION_BENCHMARK', () => {
  it('has a positive and negative threshold for every criterion', () => {
    for (const k of CRITERION_KEYS) {
      expect(CRITERION_BENCHMARK[k].positive.length).toBeGreaterThan(0);
      expect(CRITERION_BENCHMARK[k].negative.length).toBeGreaterThan(0);
    }
  });
});

describe('breakdownTooltip', () => {
  it('produces weighted human-readable lines', () => {
    const breakdown = computeBreakdown(blankRow({ trailingPE: 20, forwardPE: 15 }));
    const tip = breakdownTooltip(breakdown);
    expect(tip).toContain('P/E Compression (×2): +2');
    expect(tip.split('\n').length).toBe(12);
  });

  it('shows all 12 criteria in significance order', () => {
    const breakdown = computeBreakdown(blankRow());
    const lines = breakdownTooltip(breakdown).split('\n');
    expect(lines[0]).toContain('Earnings Quality');
    expect(lines[1]).toContain('Leverage');
    expect(lines[3]).toContain('Revenue Acceleration');
    expect(lines[5]).toContain('Margin Inflection');
    expect(lines[11]).toContain('Dividend Yield');
  });
});

describe('SCORING_VERSION', () => {
  it('is a positive integer (stamped into scan snapshots)', () => {
    expect(Number.isInteger(SCORING_VERSION)).toBe(true);
    expect(SCORING_VERSION).toBeGreaterThanOrEqual(3);
  });
  // Exact-pin: Phase 5 opened a new scoring era. Bump this alongside the constant
  // whenever criteria/neutralization change — it catches an accidental no-bump.
  it('is exactly 4 (the Phase 5 curated-financial-classifier era)', () => {
    expect(SCORING_VERSION).toBe(4);
  });
});
