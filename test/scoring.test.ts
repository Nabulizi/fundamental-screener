import { describe, it, expect } from 'vitest';
import type { ScanRow } from '@/lib/types';
import {
  computeBreakdown,
  totalScore,
  convictionTier,
  scoreRow,
  breakdownTooltip,
  isDisqualified,
  CRITERION_WEIGHT,
  type ScoreBreakdown,
} from '@/lib/scoring';

/** Minimal valid ScanRow with all nulls — scores should be all zeros. */
function blankRow(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'TEST',
    companyName: 'Test Co',
    industry: 'Tech',
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

  // --- #3 Revenue Growth (×2) ---
  it('+1 when revenue growth > 10%', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: 15 }));
    expect(b.revenueGrowth).toBe(1);
  });

  it('−1 when revenue growth < 0%', () => {
    const b = computeBreakdown(blankRow({ revenueGrowthTTM: -5 }));
    expect(b.revenueGrowth).toBe(-1);
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

describe('totalScore (weighted)', () => {
  it('sums weighted breakdown values', () => {
    const breakdown: ScoreBreakdown = {
      earningsQuality: 1,   // ×3 = +3
      leverage: 1,           // ×3 = +3
      revenueGrowth: 1,      // ×2 = +2
      fcfYieldLevel: 1,      // ×2 = +2
      peCompression: -1,     // ×2 = -2
      valuation: 1,          // ×1 = +1
      dividendCoverage: 0,   // ×1 =  0
      pricePosition: -1,     // ×1 = -1
      ytdMomentum: -1,       // ×1 = -1
      dividendYield: 0,      // ×1 =  0
    };
    // 3+3+2+2-2+1+0-1-1+0 = 7
    expect(totalScore(breakdown)).toBe(7);
  });

  it('max score is +17', () => {
    const all: ScoreBreakdown = {
      earningsQuality: 1,
      leverage: 1,
      revenueGrowth: 1,
      fcfYieldLevel: 1,
      peCompression: 1,
      valuation: 1,
      dividendCoverage: 1,
      pricePosition: 1,
      ytdMomentum: 1,
      dividendYield: 1,
    };
    expect(totalScore(all)).toBe(17);
  });

  it('min score is −16 (dividendYield has no negative)', () => {
    const all: ScoreBreakdown = {
      earningsQuality: -1,   // -3
      leverage: -1,           // -3
      revenueGrowth: -1,      // -2
      fcfYieldLevel: -1,      // -2
      peCompression: -1,      // -2
      valuation: -1,          // -1
      dividendCoverage: -1,   // -1
      pricePosition: -1,      // -1
      ytdMomentum: -1,        // -1
      dividendYield: 0,       // can't be -1 in practice, but type allows it
    };
    expect(totalScore(all)).toBe(-16);
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
    const b = computeBreakdown(blankRow({ trailingPE: 20, fcfYieldPercent: 3 }));
    expect(b.earningsQuality).toBe(-1);
    expect(isDisqualified(b)).toBe(true);
  });

  it('disqualified when Leverage is −1', () => {
    const b = computeBreakdown(blankRow({ debtToEquity: 3.0 }));
    expect(b.leverage).toBe(-1);
    expect(isDisqualified(b)).toBe(true);
  });

  it('not disqualified when both are +1', () => {
    const b = computeBreakdown(blankRow({
      trailingPE: 20,
      fcfYieldPercent: 7,
      debtToEquity: 0.5,
    }));
    expect(isDisqualified(b)).toBe(false);
  });

  it('not disqualified when both are 0', () => {
    const b = computeBreakdown(blankRow());
    expect(isDisqualified(b)).toBe(false);
  });
});

describe('convictionTier (weighted thresholds)', () => {
  it('high for scores >= 12 when not disqualified', () => {
    expect(convictionTier(12, false)).toBe('high');
    expect(convictionTier(17, false)).toBe('high');
  });

  it('watchlist for scores 7–11 when not disqualified', () => {
    expect(convictionTier(7, false)).toBe('watchlist');
    expect(convictionTier(11, false)).toBe('watchlist');
  });

  it('pass for scores < 7', () => {
    expect(convictionTier(6, false)).toBe('pass');
    expect(convictionTier(0, false)).toBe('pass');
    expect(convictionTier(-5, false)).toBe('pass');
  });

  it('pass when disqualified even if score >= 12', () => {
    expect(convictionTier(15, true)).toBe('pass');
    expect(convictionTier(12, true)).toBe('pass');
  });
});

describe('scoreRow', () => {
  it('returns high conviction for a perfect row', () => {
    const row = blankRow({
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
    // EQ ×3=+3, Lev ×3=+3, RevGr ×2=+2, FCF ×2=+2, PEC ×2=+2,
    // Val ×1=+1, DivCov ×1=+1, 52W ×1=+1, YTD ×1=+1, DivYld ×1=+1 = 17
    expect(result.score).toBe(17);
    expect(result.tier).toBe('high');
    expect(result.disqualified).toBe(false);
  });

  it('handles all-null metrics gracefully', () => {
    const result = scoreRow(blankRow());
    expect(result.score).toBe(0);
    expect(result.tier).toBe('pass');
    expect(result.disqualified).toBe(false);
  });

  it('disqualifies a high-scoring row when Earnings Quality fails', () => {
    // Row would score well on everything except EQ
    const row = blankRow({
      trailingPE: 20,
      forwardPE: 12,
      fcfYieldPercent: 3,   // EQ: 3 - 5 = −2 → −1 → disqualified
      revenueGrowthTTM: 15,
      debtToEquity: 0.5,
      evToEbitda: 10,
      rangePosition: 0.3,
      ytdReturn: 10,
      dividendYieldPercent: 2,
    });
    const result = scoreRow(row);
    expect(result.disqualified).toBe(true);
    expect(result.tier).toBe('pass');
    // Score should still be calculated (for display) even though disqualified
    expect(typeof result.score).toBe('number');
  });

  it('disqualifies when Leverage fails even with otherwise great fundamentals', () => {
    const row = blankRow({
      trailingPE: 20,
      forwardPE: 12,
      fcfYieldPercent: 8,
      revenueGrowthTTM: 15,
      debtToEquity: 3.0,   // Leverage: −1 → disqualified
      evToEbitda: 10,
      rangePosition: 0.3,
      ytdReturn: 10,
      dividendYieldPercent: 3,
    });
    const result = scoreRow(row);
    expect(result.disqualified).toBe(true);
    expect(result.tier).toBe('pass');
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
