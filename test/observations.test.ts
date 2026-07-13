import { describe, expect, it } from 'vitest';
import { FIELD_SEMANTICS, METRIC_KEYS, PERIOD_LABEL, observeRow, plausibilityFlags } from '@/lib/observations';
import type { CrossCheck } from '@/lib/crossCheck';
import type { ScanRow } from '@/lib/types';

function makeRow(overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'TEST',
    companyName: 'Test Inc',
    industry: 'Software',
    marketCap: 1_000_000_000,
    currency: 'USD',
    week52Low: 10,
    week52High: 20,
    trailingPE: 25,
    forwardPE: 22,
    dividendYieldPercent: 1.5,
    ytdReturn: 4.2,
    fcfYieldPercent: 3.1,
    revenueGrowthTTM: 12,
    debtToEquity: 0.8,
    evToEbitda: 14,
    currentPrice: 15,
    source: 'finnhub',
    retrievedAt: '2026-07-12T12:00:00.000Z',
    ...overrides
  };
}

describe('field semantics', () => {
  it('covers every visible metric with period, unit, and provider source field', () => {
    expect(METRIC_KEYS.length).toBe(11);
    for (const key of METRIC_KEYS) {
      const s = FIELD_SEMANTICS[key];
      expect(s.label.length).toBeGreaterThan(0);
      expect(PERIOD_LABEL[s.period].length).toBeGreaterThan(0);
      expect(s.sourceField.finnhub.length).toBeGreaterThan(0);
    }
  });
});

describe('observeRow', () => {
  it('attaches source, retrieval time, and an honest null effectiveAt', () => {
    const obs = observeRow(makeRow());
    expect(obs).toHaveLength(METRIC_KEYS.length);
    for (const o of obs) {
      expect(o.source).toBe('finnhub');
      expect(o.retrievedAt).toBe('2026-07-12T12:00:00.000Z');
      // Current providers never report as-of dates — must not be fabricated.
      expect(o.effectiveAt).toBeNull();
    }
    const cap = obs.find((o) => o.key === 'marketCap')!;
    expect(cap.currency).toBe('USD');
    expect(cap.period).toBe('instant');
    const pe = obs.find((o) => o.key === 'trailingPE')!;
    expect(pe.period).toBe('ttm');
    expect(pe.currency).toBeNull();
  });

  it('marks every present value single-source when there is no cross-check', () => {
    const obs = observeRow(makeRow());
    for (const o of obs) {
      if (o.value != null) expect(o.qualityFlags).toContain('single-source');
    }
  });

  it('flags missing values and never single-source on top of missing', () => {
    const obs = observeRow(makeRow({ fcfYieldPercent: null, debtToEquity: null }));
    const fcf = obs.find((o) => o.key === 'fcfYieldPercent')!;
    expect(fcf.qualityFlags).toEqual(['missing']);
  });

  it('upgrades cross-checked fields and flags material disagreement', () => {
    const crossCheck: CrossCheck = {
      available: true,
      fields: [
        { key: 'marketCap', label: 'Market cap', primary: 1e9, secondary: 1.01e9, status: 'agree', pctDiff: 0.01 },
        { key: 'trailingPE', label: 'P/E (TTM)', primary: 25, secondary: 40, status: 'differ', pctDiff: 0.6 },
        { key: 'currentPrice', label: 'Price', primary: 15, secondary: null, status: 'unavailable', pctDiff: null },
        { key: 'dividendYieldPercent', label: 'Dividend yield', primary: 1.5, secondary: 1.5, status: 'agree', pctDiff: 0 }
      ]
    };
    const obs = observeRow(makeRow(), crossCheck);
    expect(obs.find((o) => o.key === 'marketCap')!.qualityFlags).toEqual([]);
    expect(obs.find((o) => o.key === 'trailingPE')!.qualityFlags).toEqual(['secondary-disagrees']);
    // A cross-check that could not compare is still single-source.
    expect(obs.find((o) => o.key === 'currentPrice')!.qualityFlags).toContain('single-source');
    // Fields outside the shallow cross-check stay single-source.
    expect(obs.find((o) => o.key === 'fcfYieldPercent')!.qualityFlags).toContain('single-source');
  });
});

describe('plausibility validators (score-driving fields)', () => {
  it('reuses the scoring sanity bounds for revenue growth', () => {
    expect(plausibilityFlags('revenueGrowthTTM', makeRow({ revenueGrowthTTM: 350 }))).toContain('implausible');
    expect(plausibilityFlags('revenueGrowthTTM', makeRow({ revenueGrowthTTM: 80, industry: 'Banks' }))).toContain('implausible');
    expect(plausibilityFlags('revenueGrowthTTM', makeRow({ revenueGrowthTTM: 80 }))).toEqual([]);
  });

  it('flags distorted leverage and nonsense yields/multiples', () => {
    expect(plausibilityFlags('debtToEquity', makeRow({ debtToEquity: -3 }))).toContain('implausible');
    expect(plausibilityFlags('debtToEquity', makeRow({ debtToEquity: 12 }))).toContain('implausible');
    expect(plausibilityFlags('debtToEquity', makeRow({ debtToEquity: 2 }))).toEqual([]);
    expect(plausibilityFlags('dividendYieldPercent', makeRow({ dividendYieldPercent: 40 }))).toContain('implausible');
    expect(plausibilityFlags('trailingPE', makeRow({ trailingPE: 2_000 }))).toContain('implausible');
    expect(plausibilityFlags('fcfYieldPercent', makeRow({ fcfYieldPercent: -250 }))).toContain('implausible');
    expect(plausibilityFlags('marketCap', makeRow({ marketCap: -5 }))).toContain('implausible');
  });

  it('treats a genuine zero as a value, not a defect', () => {
    expect(plausibilityFlags('dividendYieldPercent', makeRow({ dividendYieldPercent: 0 }))).toEqual([]);
  });
});
