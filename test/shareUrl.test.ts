import { describe, it, expect } from 'vitest';
import { serializeShare, parseShare } from '@/lib/shareUrl';
import { EMPTY_FILTERS, type FilterCriteria } from '@/lib/filters';

const C = (over: Partial<FilterCriteria>): FilterCriteria => ({ ...EMPTY_FILTERS, ...over });

describe('share URL serialization round-trip', () => {
  it('round-trips tickers and all filter fields', () => {
    const tickers = ['AAPL', 'MSFT', 'KO'];
    const filters = C({
      industry: 'Technology',
      marketCapMin: 100_000_000_000,
      marketCapMax: 3_000_000_000_000,
      peMin: 5,
      peMax: 40,
      dividendYieldMin: 2,
      rangePositionMin: 0.25,
      rangePositionMax: 0.9,
      includeUnavailable: true
    });
    const qs = serializeShare(tickers, filters);
    const out = parseShare(new URLSearchParams(qs));
    expect(out.tickers).toEqual(tickers);
    expect(out.filters).toEqual(filters);
  });

  it('produces empty defaults when nothing is set', () => {
    const qs = serializeShare([], EMPTY_FILTERS);
    expect(qs).toBe('');
    const out = parseShare(new URLSearchParams(qs));
    expect(out.tickers).toEqual([]);
    expect(out.filters).toEqual(EMPTY_FILTERS);
  });

  it('ignores malformed numeric params (falls back to null)', () => {
    const out = parseShare(new URLSearchParams('pemin=abc&mcmin=&dymin=xyz'));
    expect(out.filters.peMin).toBeNull();
    expect(out.filters.marketCapMin).toBeNull();
    expect(out.filters.dividendYieldMin).toBeNull();
  });

  it('uppercases and trims tickers on restore', () => {
    const out = parseShare(new URLSearchParams('t=aapl, msft ,ko'));
    expect(out.tickers).toEqual(['AAPL', 'MSFT', 'KO']);
  });

  it('does not emit any key-like or sensitive params', () => {
    const qs = serializeShare(['AAPL'], C({ peMax: 30 }));
    expect(qs.toLowerCase()).not.toContain('key');
    expect(qs.toLowerCase()).not.toContain('token');
    // only known short param names appear
    const allowed = new Set(['t', 'ind', 'mcmin', 'mcmax', 'pemin', 'pemax', 'dymin', 'rpmin', 'rpmax', 'smin', 'rmax', 'cmin', 'inc', 'v']);
    for (const [k] of new URLSearchParams(qs)) {
      expect(allowed.has(k)).toBe(true);
    }
  });

  it('round-trips the evidence-aware v2 filters with a version stamp', () => {
    const qs = serializeShare(['AAPL'], C({ strengthMin: 12, riskMax: 5, coverageMin: 0.7 }));
    expect(new URLSearchParams(qs).get('v')).toBe('2');
    const out = parseShare(new URLSearchParams(qs));
    expect(out.filters.strengthMin).toBe(12);
    expect(out.filters.riskMax).toBe(5);
    expect(out.filters.coverageMin).toBe(0.7);
  });

  it('leaves bare ticker links unversioned', () => {
    const qs = serializeShare(['AAPL'], C({}));
    expect(new URLSearchParams(qs).get('v')).toBeNull();
  });

  it('keeps tickers but drops filters from a newer-schema link', () => {
    const out = parseShare(new URLSearchParams('t=AAPL&v=99&smin=12&newthing=5'));
    expect(out.tickers).toEqual(['AAPL']);
    expect(out.filters.strengthMin).toBeNull();
  });

  it('parses legacy links without a version param', () => {
    const out = parseShare(new URLSearchParams('t=AAPL&pemax=30'));
    expect(out.filters.peMax).toBe(30);
  });
});
