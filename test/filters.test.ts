import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  applyFilters,
  rowMatches,
  distinctIndustries,
  describeActiveFilters,
  activeFilterCount,
  clearFilter,
  type FilterCriteria
} from '@/lib/filters';
import type { ScanRow } from '@/lib/types';

function row(over: Partial<ScanRow>): ScanRow {
  return {
    ticker: 'X',
    companyName: 'X Inc',
    industry: 'Technology',
    marketCap: 1_000_000_000,
    currency: 'USD',
    week52Low: 10,
    week52High: 20,
    trailingPE: 15,
    forwardPE: null,
    dividendYieldPercent: 2,
    ytdReturn: null,
    fcfYieldPercent: null,
    revenueGrowthTTM: null,
    debtToEquity: null,
    evToEbitda: null,
    retrievedAt: '2026-06-19T00:00:00.000Z',
    ...over
  };
}

const C = (over: Partial<FilterCriteria>): FilterCriteria => ({ ...EMPTY_FILTERS, ...over });

describe('applyFilters - inactive', () => {
  it('returns all rows when no filters are set', () => {
    const rows = [row({ ticker: 'A' }), row({ ticker: 'B' })];
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(2);
  });
});

describe('numeric filters', () => {
  it('filters by market cap min/max (raw units)', () => {
    const rows = [row({ ticker: 'A', marketCap: 5e9 }), row({ ticker: 'B', marketCap: 50e9 })];
    expect(applyFilters(rows, C({ marketCapMin: 10e9 })).map((r) => r.ticker)).toEqual(['B']);
    expect(applyFilters(rows, C({ marketCapMax: 10e9 })).map((r) => r.ticker)).toEqual(['A']);
  });

  it('filters by P/E range', () => {
    const rows = [row({ ticker: 'A', trailingPE: 10 }), row({ ticker: 'B', trailingPE: 40 })];
    expect(applyFilters(rows, C({ peMin: 5, peMax: 20 })).map((r) => r.ticker)).toEqual(['A']);
  });

  it('filters by minimum dividend yield', () => {
    const rows = [row({ ticker: 'A', dividendYieldPercent: 1 }), row({ ticker: 'B', dividendYieldPercent: 3 })];
    expect(applyFilters(rows, C({ dividendYieldMin: 2 })).map((r) => r.ticker)).toEqual(['B']);
  });
});

describe('missing values', () => {
  it('fails an active numeric filter by default when the value is missing', () => {
    const rows = [row({ ticker: 'A', trailingPE: null })];
    expect(applyFilters(rows, C({ peMin: 5 }))).toHaveLength(0);
  });

  it('includes missing values when includeUnavailable is set', () => {
    const rows = [row({ ticker: 'A', trailingPE: null })];
    expect(applyFilters(rows, C({ peMin: 5, includeUnavailable: true }))).toHaveLength(1);
  });

  it('treats a real 0 as a value, not missing', () => {
    const rows = [row({ ticker: 'A', dividendYieldPercent: 0 })];
    // min 0 includes it; min 1 excludes it (0 is a real value, compared normally)
    expect(applyFilters(rows, C({ dividendYieldMin: 0 }))).toHaveLength(1);
    expect(applyFilters(rows, C({ dividendYieldMin: 1 }))).toHaveLength(0);
  });

  it('missing industry fails the industry filter unless includeUnavailable', () => {
    const r = row({ industry: null });
    expect(rowMatches(r, C({ industry: 'Technology' }))).toBe(false);
    expect(rowMatches(r, C({ industry: 'Technology', includeUnavailable: true }))).toBe(true);
  });
});

describe('combined filters', () => {
  it('applies multiple filters together (AND)', () => {
    const rows = [
      row({ ticker: 'A', industry: 'Technology', marketCap: 50e9, trailingPE: 15, dividendYieldPercent: 2 }),
      row({ ticker: 'B', industry: 'Technology', marketCap: 50e9, trailingPE: 15, dividendYieldPercent: 0.5 }),
      row({ ticker: 'C', industry: 'Retail', marketCap: 50e9, trailingPE: 15, dividendYieldPercent: 2 })
    ];
    const out = applyFilters(rows, C({ industry: 'Technology', marketCapMin: 10e9, peMax: 20, dividendYieldMin: 1 }));
    expect(out.map((r) => r.ticker)).toEqual(['A']);
  });
});

describe('range position filter', () => {
  it('filters by 52-week range position when present, missing fails by default', () => {
    const rows = [
      row({ ticker: 'A', rangePosition: 0.9 }),
      row({ ticker: 'B', rangePosition: 0.2 }),
      row({ ticker: 'C', rangePosition: null })
    ];
    expect(applyFilters(rows, C({ rangePositionMin: 0.5 })).map((r) => r.ticker)).toEqual(['A']);
    expect(applyFilters(rows, C({ rangePositionMin: 0.5, includeUnavailable: true })).map((r) => r.ticker)).toEqual(['A', 'C']);
  });
});

describe('helpers', () => {
  it('lists distinct sorted non-empty industries', () => {
    const rows = [row({ industry: 'Retail' }), row({ industry: 'Technology' }), row({ industry: 'Retail' }), row({ industry: null })];
    expect(distinctIndustries(rows)).toEqual(['Retail', 'Technology']);
  });

  it('counts and describes active filters and clears one', () => {
    const c = C({ industry: 'Technology', peMax: 30 });
    expect(activeFilterCount(c)).toBe(2);
    const chips = describeActiveFilters(c);
    expect(chips.map((x) => x.key)).toEqual(['industry', 'peMax']);
    const cleared = clearFilter(c, 'peMax');
    expect(cleared.peMax).toBeNull();
    expect(activeFilterCount(cleared)).toBe(1);
  });
});

describe('evidence-aware criteria (strength/risk/coverage)', () => {
  const scoreOf = (r: { ticker: string }) =>
    r.ticker === 'GOOD'
      ? { strength: 14, risk: 3, coverage: 0.9 }
      : r.ticker === 'RISKY'
        ? { strength: 15, risk: 9, coverage: 0.8 }
        : undefined; // SPARSE has no scores

  const rows = [row({ ticker: 'GOOD' }), row({ ticker: 'RISKY' }), row({ ticker: 'SPARSE' })];

  it('filters by minimum strength, maximum risk, and minimum coverage', () => {
    expect(applyFilters(rows, C({ strengthMin: 12 }), scoreOf).map((r) => r.ticker)).toEqual(['GOOD', 'RISKY']);
    expect(applyFilters(rows, C({ strengthMin: 12, riskMax: 5 }), scoreOf).map((r) => r.ticker)).toEqual(['GOOD']);
    expect(applyFilters(rows, C({ coverageMin: 0.85 }), scoreOf).map((r) => r.ticker)).toEqual(['GOOD']);
  });

  it('rows without scores fail active score filters unless includeUnavailable', () => {
    expect(applyFilters(rows, C({ riskMax: 10 }), scoreOf).map((r) => r.ticker)).toEqual(['GOOD', 'RISKY']);
    expect(applyFilters(rows, C({ riskMax: 10, includeUnavailable: true }), scoreOf).map((r) => r.ticker)).toEqual(['GOOD', 'RISKY', 'SPARSE']);
  });

  it('score filters are inert when no score context is provided', () => {
    expect(applyFilters(rows, C({}), scoreOf)).toHaveLength(3);
    // Active score filter with NO scoreOf at all: every row lacks scores.
    expect(applyFilters(rows, C({ strengthMin: 1 }))).toHaveLength(0);
  });
});
