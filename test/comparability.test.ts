import { describe, expect, it } from 'vitest';
import { distinctCurrencies, mixedCurrency, peerComparabilityWarnings } from '@/lib/comparability';
import { buildPeerComparison } from '@/lib/peers';
import type { ScanRow } from '@/lib/types';

function row(over: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'X', companyName: 'X Co', industry: 'Technology', marketCap: 1e9, currency: 'USD',
    week52Low: null, week52High: null, trailingPE: null, forwardPE: null, dividendYieldPercent: null,
    ytdReturn: null, fcfYieldPercent: 5, revenueGrowthTTM: 10, debtToEquity: null, evToEbitda: 15,
    operatingMarginTTM: 20, retrievedAt: '2026-01-01T00:00:00Z', ...over,
  };
}

describe('currency comparability', () => {
  it('single known currency is comparable', () => {
    expect(mixedCurrency([row(), row(), row()])).toBe(false);
    expect(distinctCurrencies([row(), row()])).toEqual(['USD']);
  });

  it('two known currencies are not comparable', () => {
    expect(mixedCurrency([row(), row({ currency: 'EUR' })])).toBe(true);
  });

  it('an unknown currency alongside a known one is conservatively not comparable', () => {
    expect(mixedCurrency([row(), row({ currency: null })])).toBe(true);
  });

  it('all-unknown or single rows do not trigger the guard', () => {
    expect(mixedCurrency([row({ currency: null }), row({ currency: null })])).toBe(false);
    expect(mixedCurrency([row({ currency: 'EUR' })])).toBe(false);
  });
});

describe('peer comparability warnings', () => {
  it('is silent for an aligned peer set', () => {
    expect(peerComparabilityWarnings(row(), [row({ ticker: 'A' }), row({ ticker: 'B' })])).toEqual([]);
  });

  it('warns on mixed currency and mixed industry', () => {
    const warnings = peerComparabilityWarnings(
      row(),
      [row({ ticker: 'SAP', currency: 'EUR', industry: 'Software' })]
    );
    expect(warnings.map((w) => w.kind).sort()).toEqual(['mixed-currency', 'mixed-industry']);
    expect(warnings.find((w) => w.kind === 'mixed-currency')!.message).toContain('EUR');
  });
});

describe('peer median monetary guard', () => {
  const peers = (ccy: (string | null)[]) =>
    ccy.map((currency, i) => row({ ticker: `P${i}`, currency, marketCap: (i + 1) * 1e9 }));

  it('suppresses the market-cap median across mixed currencies but keeps ratio medians', () => {
    const m = buildPeerComparison(row(), peers(['USD', 'EUR', 'USD']));
    expect(m.medians).not.toBeNull();
    expect(m.medians!.mixedCurrency).toBe(true);
    expect(m.medians!.marketCap).toBeNull();
    expect(m.medians!.counts.marketCap).toBe(0);
    expect(m.medians!.evToEbitda).toBe(15); // ratios remain comparable
  });

  it('suppresses when the SELECTED company is the odd currency out', () => {
    const m = buildPeerComparison(row({ currency: 'JPY' }), peers(['USD', 'USD', 'USD']));
    expect(m.medians!.mixedCurrency).toBe(true);
    expect(m.medians!.marketCap).toBeNull();
  });

  it('keeps the market-cap median and reports observation counts when aligned', () => {
    const m = buildPeerComparison(row(), peers(['USD', 'USD', 'USD']));
    expect(m.medians!.mixedCurrency).toBe(false);
    expect(m.medians!.marketCap).toBe(2e9);
    expect(m.medians!.counts.marketCap).toBe(3);
    expect(m.medians!.counts.fcfYield).toBe(3);
  });
});
