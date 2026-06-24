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
  CRITERION_WEIGHT,
  CRITERION_BENCHMARK,
  CRITERION_KEYS,
  MEGA_CAP_THRESHOLD,
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

const NO_FLAGS: RowFlags = { disqualified: false, cyclical: false, crowding: false, benignEarningsQuality: false };

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

describe('industry classification helpers', () => {
  it('detects cyclical industries', () => {
    expect(isCyclicalIndustry('Semiconductors')).toBe(true);
    expect(isCyclicalIndustry('Automobiles')).toBe(true);
    expect(isCyclicalIndustry('Software')).toBe(false);
    expect(isCyclicalIndustry(null)).toBe(false);
  });

  it('detects financial industries', () => {
    expect(isFinancialIndustry('Financial Services')).toBe(true);
    expect(isFinancialIndustry('Banks')).toBe(true);
    expect(isFinancialIndustry('Insurance')).toBe(true);
    expect(isFinancialIndustry('Technology')).toBe(false);
    expect(isFinancialIndustry(null)).toBe(false);
  });
});

describe('computeScores (split strength / risk)', () => {
  it('strength sums only positive weighted signals', () => {
    const breakdown: ScoreBreakdown = {
      earningsQuality: 1,   // ×3 = +3
      leverage: 1,           // ×3 = +3
      revenueGrowth: 1,      // ×2 = +2
      fcfYieldLevel: 1,      // ×2 = +2
      peCompression: -1,     // ×2 = -2 (→ risk)
      valuation: 1,          // ×1 = +1
      dividendCoverage: 0,
      pricePosition: -1,     // ×1 = -1 (→ risk)
      ytdMomentum: -1,       // ×1 = -1 (→ risk)
      dividendYield: 0,
    };
    const { strength, risk } = computeScores(breakdown);
    expect(strength).toBe(11); // 3+3+2+2+1
    expect(risk).toBe(4);      // 2+1+1
    expect(totalScore(breakdown)).toBe(7); // strength − risk
  });

  it('max strength is +17', () => {
    const all: ScoreBreakdown = {
      earningsQuality: 1, leverage: 1, revenueGrowth: 1, fcfYieldLevel: 1,
      peCompression: 1, valuation: 1, dividendCoverage: 1, pricePosition: 1,
      ytdMomentum: 1, dividendYield: 1,
    };
    expect(computeScores(all).strength).toBe(17);
    expect(computeScores(all).risk).toBe(0);
  });

  it('max risk is 16 (dividendYield never negative)', () => {
    const all: ScoreBreakdown = {
      earningsQuality: -1, leverage: -1, revenueGrowth: -1, fcfYieldLevel: -1,
      peCompression: -1, valuation: -1, dividendCoverage: -1, pricePosition: -1,
      ytdMomentum: -1, dividendYield: 0,
    };
    expect(computeScores(all).risk).toBe(16);
    expect(computeScores(all).strength).toBe(0);
  });

  it('weights are correct per tier', () => {
    expect(CRITERION_WEIGHT.earningsQuality).toBe(3);
    expect(CRITERION_WEIGHT.leverage).toBe(3);
    expect(CRITERION_WEIGHT.revenueGrowth).toBe(2);
    expect(CRITERION_WEIGHT.fcfYieldLevel).toBe(2);
    expect(CRITERION_WEIGHT.peCompression).toBe(2);
    expect(CRITERION_WEIGHT.valuation).toBe(1);
    expect(CRITERION_WEIGHT.dividendCoverage).toBe(1);
    expect(CRITERION_WEIGHT.pricePosition).toBe(1);
    expect(CRITERION_WEIGHT.ytdMomentum).toBe(1);
    expect(CRITERION_WEIGHT.dividendYield).toBe(1);
  });
});

describe('isDisqualified (hard floor rule)', () => {
  it('disqualified when Earnings Quality is −1', () => {
    const row = blankRow({ trailingPE: 20, fcfYieldPercent: 3 });
    const b = computeBreakdown(row);
    expect(b.earningsQuality).toBe(-1);
    expect(isDisqualified(b, row)).toBe(true);
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
    // EQ = −1 (FCF 3% vs EY 5%), but FCF≥2 and revenue +150% → benign → not disqualified
    const benign = blankRow({ trailingPE: 20, fcfYieldPercent: 3, revenueGrowthTTM: 150 });
    const bb = computeBreakdown(benign);
    expect(bb.earningsQuality).toBe(-1);
    expect(isDisqualified(bb, benign)).toBe(false);

    // Same weak EQ but ordinary growth → still disqualified
    const harsh = blankRow({ trailingPE: 20, fcfYieldPercent: 3, revenueGrowthTTM: 5 });
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

describe('tierFor (neutral signal tiers)', () => {
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

  it('forces weak when Earnings Quality fails despite strong fundamentals', () => {
    const row = blankRow({
      trailingPE: 20,
      forwardPE: 12,
      fcfYieldPercent: 3,   // EQ: 3 − 5 = −2 → −1 → disqualified
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
  it('shows FCF vs Earnings Yield for earnings quality', () => {
    expect(criterionEvidence(blankRow({ trailingPE: 20, fcfYieldPercent: 7 }), 'earningsQuality'))
      .toBe('FCF 7.00% vs EY 5.00%');
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
    expect(tip.split('\n').length).toBe(10);
  });

  it('shows all 10 criteria in significance order', () => {
    const breakdown = computeBreakdown(blankRow());
    const lines = breakdownTooltip(breakdown).split('\n');
    expect(lines[0]).toContain('Earnings Quality');
    expect(lines[1]).toContain('Leverage');
    expect(lines[9]).toContain('Dividend Yield');
  });
});
