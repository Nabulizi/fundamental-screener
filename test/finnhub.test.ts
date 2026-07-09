import { describe, it, expect } from 'vitest';
import { normalizeFinnhub } from '@/lib/finnhub';

const AT = '2026-06-19T20:00:00.000Z';

describe('normalizeFinnhub', () => {
  it('maps fields and converts market cap from millions to raw units', () => {
    const row = normalizeFinnhub(
      'AAPL',
      { name: 'Apple Inc', finnhubIndustry: 'Technology', marketCapitalization: 3_000_000, currency: 'USD' },
      { '52WeekHigh': 260.1, '52WeekLow': 164.08, peTTM: 31.2, dividendYieldIndicatedAnnual: 0.41 },
      AT
    );
    expect(row.companyName).toBe('Apple Inc');
    expect(row.industry).toBe('Technology');
    expect(row.marketCap).toBe(3_000_000 * 1_000_000); // 3e12
    expect(row.week52High).toBe(260.1);
    expect(row.trailingPE).toBe(31.2);
    expect(row.dividendYieldPercent).toBe(0.41);
    expect(row.retrievedAt).toBe(AT);
    expect(row.source).toBe('finnhub');
  });

  it('preserves a genuine 0% dividend yield (non-payer), not null', () => {
    const row = normalizeFinnhub('AMZN', { name: 'Amazon', currency: 'USD' }, { dividendYieldIndicatedAnnual: 0 }, AT);
    expect(row.dividendYieldPercent).toBe(0);
  });

  it('treats a missing dividend yield as null (rendered N/A), not 0', () => {
    const row = normalizeFinnhub('AMZN', { name: 'Amazon', currency: 'USD' }, {}, AT);
    expect(row.dividendYieldPercent).toBeNull();
  });

  it('normalizes negative / unprofitable P/E to null', () => {
    const row = normalizeFinnhub('XYZ', { name: 'Lossmaker', currency: 'USD' }, { peTTM: -12.5 }, AT);
    expect(row.trailingPE).toBeNull();
  });

  it('extracts forward P/E when available', () => {
    const row = normalizeFinnhub('AAPL', { name: 'Apple', currency: 'USD' }, { forwardPE: 33.39 }, AT);
    expect(row.forwardPE).toBe(33.39);
  });

  it('normalizes negative forward P/E to null', () => {
    const row = normalizeFinnhub('XYZ', { name: 'Lossmaker', currency: 'USD' }, { forwardPE: -5.2 }, AT);
    expect(row.forwardPE).toBeNull();
  });

  it('returns null forward P/E when field is missing', () => {
    const row = normalizeFinnhub('NEW', { name: 'Newly Listed', currency: 'USD' }, {}, AT);
    expect(row.forwardPE).toBeNull();
  });

  it('passes negative D/E through (negative book equity — scorer arbitrates)', () => {
    const row = normalizeFinnhub('MCD', { name: "McDonald's", currency: 'USD' }, { 'totalDebt/totalEquityQuarterly': -4.2 }, AT);
    expect(row.debtToEquity).toBe(-4.2);
  });

  it('maps net interest coverage TTM', () => {
    const row = normalizeFinnhub('AAPL', { name: 'Apple', currency: 'USD' }, { netInterestCoverageTTM: 28.4 }, AT);
    expect(row.interestCoverage).toBe(28.4);
  });

  it('returns null interest coverage when the field is missing', () => {
    const row = normalizeFinnhub('NEW', { name: 'Newly Listed', currency: 'USD' }, {}, AT);
    expect(row.interestCoverage).toBeNull();
  });

  it('maps quarterly revenue growth and operating margins (TTM + 5Y)', () => {
    const row = normalizeFinnhub('AAPL', { name: 'Apple', currency: 'USD' }, {
      revenueGrowthQuarterlyYoy: 7.94,
      operatingMarginTTM: 31.72,
      operatingMargin5Y: 29.31,
    }, AT);
    expect(row.revenueGrowthQuarterly).toBe(7.94);
    expect(row.operatingMarginTTM).toBe(31.72);
    expect(row.operatingMargin5Y).toBe(29.31);
  });

  it('returns null improvement fields when missing', () => {
    const row = normalizeFinnhub('NEW', { name: 'Newly Listed', currency: 'USD' }, {}, AT);
    expect(row.revenueGrowthQuarterly).toBeNull();
    expect(row.operatingMarginTTM).toBeNull();
    expect(row.operatingMargin5Y).toBeNull();
  });

  it('extracts YTD return when available', () => {
    const row = normalizeFinnhub('AAPL', { name: 'Apple', currency: 'USD' }, { yearToDatePriceReturnDaily: 9.25 }, AT);
    expect(row.ytdReturn).toBe(9.25);
  });

  it('returns null YTD return when field is missing', () => {
    const row = normalizeFinnhub('NEW', { name: 'Newly Listed', currency: 'USD' }, {}, AT);
    expect(row.ytdReturn).toBeNull();
  });

  it('labels US-listed ADRs in USD even when the reporting currency differs (BABA)', () => {
    const row = normalizeFinnhub(
      'BABA',
      {
        name: 'Alibaba Group Holding Ltd',
        finnhubIndustry: 'Retail',
        marketCapitalization: 256823,
        currency: 'CNY', // financial-reporting currency
        exchange: 'NEW YORK STOCK EXCHANGE, INC.'
      },
      { '52WeekHigh': 192.67, '52WeekLow': 103.71 },
      AT
    );
    expect(row.currency).toBe('USD');
    expect(row.marketCap).toBe(256823 * 1_000_000);
  });

  it('keeps the reporting currency for genuinely foreign-listed stocks', () => {
    const row = normalizeFinnhub(
      'SAP',
      { name: 'SAP SE', currency: 'EUR', exchange: 'XETRA' },
      {},
      AT
    );
    expect(row.currency).toBe('EUR');
  });

  it('keeps missing fundamentals as null while still returning the company', () => {
    const row = normalizeFinnhub('NEW', { name: 'Newly Listed', currency: 'USD' }, {}, AT);
    expect(row.companyName).toBe('Newly Listed');
    expect(row.marketCap).toBeNull();
    expect(row.week52High).toBeNull();
    expect(row.trailingPE).toBeNull();
  });

  it('maps current price from the quote and computes raw range position', () => {
    const row = normalizeFinnhub(
      'AAPL',
      { name: 'Apple Inc', currency: 'USD', exchange: 'NASDAQ NMS - GLOBAL MARKET' },
      { '52WeekLow': 100, '52WeekHigh': 200 },
      AT,
      { c: 150 }
    );
    expect(row.currentPrice).toBe(150);
    expect(row.rangePosition).toBe(0.5);
  });

  it('treats a non-positive quote price as no price (null)', () => {
    const row = normalizeFinnhub('X', { name: 'X', currency: 'USD' }, { '52WeekLow': 1, '52WeekHigh': 2 }, AT, { c: 0 });
    expect(row.currentPrice).toBeNull();
    expect(row.rangePosition).toBeNull();
  });

  it('leaves price/range null when no quote is provided', () => {
    const row = normalizeFinnhub('X', { name: 'X', currency: 'USD' }, { '52WeekLow': 1, '52WeekHigh': 2 }, AT);
    expect(row.currentPrice).toBeNull();
    expect(row.rangePosition).toBeNull();
  });
});
