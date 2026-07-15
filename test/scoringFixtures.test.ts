import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scoreRow, SCORING_VERSION } from '@/lib/scoring';
import type { ScanRow } from '@/lib/types';

/**
 * Golden parity fixtures for the quant-research QR-008 experiment.
 *
 * The quant-research repo reimplements this scorer in Python to backtest the
 * shipped composite on QuantConnect point-in-time data. Its parity test
 * replays these exact inputs and asserts identical outputs — that is the
 * "frozen as-is" guarantee of the preregistration.
 *
 * Normal runs: assert the committed golden file matches the live scorer, so
 * any scoring change without a regen (and a SCORING_VERSION bump) fails CI.
 * Regenerate after an INTENTIONAL scoring change:
 *
 *   EXPORT_FIXTURES=1 npx vitest run test/scoringFixtures.test.ts
 *
 * then copy test/fixtures/scoring-v5-golden.json into quant-research.
 */

const GOLDEN_PATH = fileURLToPath(new URL('./fixtures/scoring-v5-golden.json', import.meta.url));

function row(overrides: Partial<ScanRow>): ScanRow {
  return {
    ticker: 'TEST',
    companyName: null,
    industry: 'Software—Application', // not cyclical/financial/REIT
    marketCap: 10_000_000_000,
    currency: 'USD',
    week52Low: null,
    week52High: null,
    trailingPE: null,
    forwardPE: null,
    dividendYieldPercent: null,
    ytdReturn: null,
    fcfYieldPercent: null,
    revenueGrowthTTM: null,
    debtToEquity: null,
    evToEbitda: null,
    interestCoverage: null,
    revenueGrowthQuarterly: null,
    operatingMarginTTM: null,
    operatingMargin5Y: null,
    currentPrice: null,
    rangePosition: null,
    retrievedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Fully-covered baseline so single-criterion cases aren't drowned by the
 *  insufficient-data floor. Every criterion lands neutral-or-positive. */
const covered: Partial<ScanRow> = {
  trailingPE: 20,
  forwardPE: 20,
  fcfYieldPercent: 4, // conversion 0.8: neutral band
  revenueGrowthTTM: 5,
  revenueGrowthQuarterly: 5,
  debtToEquity: 1.5,
  evToEbitda: 18,
  interestCoverage: 10,
  dividendYieldPercent: 1,
  ytdReturn: 0,
  operatingMarginTTM: 20,
  operatingMargin5Y: 20,
  rangePosition: 0.5,
};

const CASES: { name: string; input: ScanRow }[] = [
  { name: 'all-null-insufficient-data', input: row({}) },
  {
    name: 'strong-clean-max-strength',
    input: row({
      trailingPE: 20, forwardPE: 16, fcfYieldPercent: 6, revenueGrowthTTM: 15,
      revenueGrowthQuarterly: 20, debtToEquity: 0.5, evToEbitda: 10,
      interestCoverage: 12, dividendYieldPercent: 2, ytdReturn: 5,
      operatingMarginTTM: 25, operatingMargin5Y: 20, rangePosition: 0.3,
    }),
  },
  { name: 'eq-conversion-exactly-1.0-neutral', input: row({ ...covered, fcfYieldPercent: 5, trailingPE: 20 }) },
  { name: 'eq-soft-band-caps-moderate', input: row({ ...covered, fcfYieldPercent: 3, trailingPE: 20 }) }, // conversion 0.6
  { name: 'eq-critical-disqualifies', input: row({ ...covered, fcfYieldPercent: 2, trailingPE: 20 }) },   // conversion 0.4
  { name: 'eq-negative-fcf-disqualifies', input: row({ ...covered, fcfYieldPercent: -3 }) },
  {
    name: 'eq-benign-growth-waiver',
    input: row({ ...covered, fcfYieldPercent: 2.5, trailingPE: 15, revenueGrowthTTM: 25, revenueGrowthQuarterly: 25 }), // conversion 0.375, hyper-growth
  },
  { name: 'leverage-low-de-positive', input: row({ ...covered, debtToEquity: 0.5 }) },
  { name: 'leverage-de-exactly-1.0-neutral', input: row({ ...covered, debtToEquity: 1.0 }) },
  { name: 'leverage-de-exactly-2.0-neutral', input: row({ ...covered, debtToEquity: 2.0 }) },
  { name: 'leverage-de-2.1-no-coverage-disqualifies', input: row({ ...covered, debtToEquity: 2.1, interestCoverage: null }) },
  { name: 'leverage-de-2.1-middling-coverage-disqualifies', input: row({ ...covered, debtToEquity: 2.1, interestCoverage: 4 }) },
  { name: 'leverage-serviceable-waiver', input: row({ ...covered, debtToEquity: 3, interestCoverage: 7 }) },
  { name: 'leverage-coverage-first-weak-ic', input: row({ ...covered, debtToEquity: 0.5, interestCoverage: 1 }) },
  { name: 'leverage-distorted-de-neutralized', input: row({ ...covered, debtToEquity: 15, interestCoverage: 8 }) },
  { name: 'leverage-negative-de-no-coverage-neutral', input: row({ ...covered, debtToEquity: -5, interestCoverage: null }) },
  { name: 'financial-neutralizations', input: row({ ...covered, ticker: 'JPM', industry: 'Banks—Diversified' }) },
  { name: 'financial-suspect-growth-80', input: row({ ...covered, ticker: 'JPM', industry: 'Banks—Diversified', revenueGrowthTTM: 80 }) },
  { name: 'override-balance-sheet-COF', input: row({ ...covered, ticker: 'COF', industry: 'Credit Services' }) },
  { name: 'override-asset-light-V', input: row({ ...covered, ticker: 'V', industry: 'Credit Services' }) },
  { name: 'reit-leverage-neutralized-fcf-scored', input: row({ ...covered, industry: 'REIT—Retail', debtToEquity: 4, fcfYieldPercent: 6, trailingPE: 25 }) },
  { name: 'cyclical-compression-plus-suppressed', input: row({ ...covered, industry: 'Semiconductors', trailingPE: 20, forwardPE: 15 }) },
  { name: 'cyclical-compression-minus-kept', input: row({ ...covered, industry: 'Semiconductors', trailingPE: 10, forwardPE: 14, evToEbitda: 18 }) },
  { name: 'peak-cycle-cap', input: row({ ...covered, industry: 'Semiconductors', trailingPE: 8, forwardPE: 12, evToEbitda: 6 }) },
  { name: 'value-trap-cap', input: row({ ...covered, evToEbitda: 6, revenueGrowthTTM: -5, revenueGrowthQuarterly: -5 }) },
  { name: 'crowding-cap-megacap-at-high', input: row({ ...covered, marketCap: 300_000_000_000, rangePosition: 0.95, trailingPE: 20, forwardPE: 16, fcfYieldPercent: 6, revenueGrowthTTM: 15, debtToEquity: 0.5, evToEbitda: 10 }) },
  { name: 'dividend-coverage-exact-equality-negative', input: row({ ...covered, fcfYieldPercent: 4, dividendYieldPercent: 4 }) },
  { name: 'non-payer-dividend-neutral', input: row({ ...covered, dividendYieldPercent: 0 }) },
  { name: 'suspect-growth-general-400', input: row({ ...covered, revenueGrowthTTM: 400 }) },
  { name: 'suspect-growth-below-minus-100', input: row({ ...covered, revenueGrowthTTM: -150 }) },
  { name: 'range-position-exactly-0.4-neutral', input: row({ ...covered, rangePosition: 0.4 }) },
  { name: 'range-position-0.39-positive', input: row({ ...covered, rangePosition: 0.39 }) },
  { name: 'range-position-0.91-negative', input: row({ ...covered, rangePosition: 0.91 }) },
  {
    name: 'risk-floor-forces-weak',
    input: row({
      trailingPE: 30, forwardPE: 35, fcfYieldPercent: 1.5, revenueGrowthTTM: -10,
      revenueGrowthQuarterly: -20, debtToEquity: 0.5, evToEbitda: 30,
      interestCoverage: 10, dividendYieldPercent: 3, ytdReturn: -15,
      operatingMarginTTM: 10, operatingMargin5Y: 15, rangePosition: 0.95,
    }),
  },
  {
    name: 'moderate-band-mid-strength',
    input: row({
      ...covered, fcfYieldPercent: 7, trailingPE: 15, debtToEquity: 0.5, // EQ +3 (conv 1.05), FCF +2, leverage +3 → 8 with rest neutral
    }),
  },
  { name: 'sanitize-pe-above-1000-dropped', input: row({ ...covered, trailingPE: 5000 }) },
  { name: 'sanitize-dividend-yield-above-25-dropped', input: row({ ...covered, dividendYieldPercent: 40 }) },
];

function goldenDoc() {
  return {
    scoringVersion: SCORING_VERSION,
    generatedBy: 'test/scoringFixtures.test.ts',
    cases: CASES.map(({ name, input }) => {
      const { row: _echo, ...output } = scoreRow(input);
      return { name, input, output };
    }),
  };
}

describe('scoring golden fixtures (quant-research parity)', () => {
  if (process.env.EXPORT_FIXTURES) {
    it('exports the golden file', () => {
      writeFileSync(GOLDEN_PATH, JSON.stringify(goldenDoc(), null, 2) + '\n');
      expect(CASES.length).toBeGreaterThan(0);
    });
    return;
  }

  it('case names are unique', () => {
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
  });

  it('committed golden file matches the live scorer exactly', () => {
    let golden: unknown;
    try {
      golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    } catch {
      throw new Error('Missing/unreadable golden file. Generate it: EXPORT_FIXTURES=1 npx vitest run test/scoringFixtures.test.ts');
    }
    // A scoring change requires BOTH a SCORING_VERSION bump and a regen —
    // this deep-equal fails on either being forgotten.
    expect(golden).toEqual(JSON.parse(JSON.stringify(goldenDoc())));
  });
});
