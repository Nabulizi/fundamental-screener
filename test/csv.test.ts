import { describe, it, expect } from 'vitest';
import { toCsv, escapeCsvField } from '@/lib/csv';
import type { ScanRow } from '@/lib/types';
import { SCORING_VERSION } from '@/lib/scoring';

function row(over: Partial<ScanRow>): ScanRow {
  return {
    ticker: 'AAPL',
    companyName: 'Apple Inc',
    industry: 'Technology',
    marketCap: 3_000_000_000_000,
    currency: 'USD',
    week52Low: 164.08,
    week52High: 260.1,
    trailingPE: 31.2,
    forwardPE: 33.4,
    dividendYieldPercent: 0.41,
    ytdReturn: 9.25,
    fcfYieldPercent: 2.96,
    revenueGrowthTTM: 12.76,
    debtToEquity: 1.35,
    evToEbitda: 27.58,
    currentPrice: 200,
    rangePosition: 0.5,
    retrievedAt: '2026-06-19T20:00:00.000Z',
    ...over
  };
}

describe('escapeCsvField', () => {
  it('quotes fields with commas and escapes inner quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('plain')).toBe('plain');
  });
});

describe('toCsv', () => {
  it('emits a header row and one row per company in order', () => {
    const csv = toCsv([row({ ticker: 'AAPL' }), row({ ticker: 'MSFT', companyName: 'Microsoft' })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Ticker,Company,Industry,Market Cap,Price');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('AAPL');
    expect(lines[2]).toContain('MSFT');
  });

  it('writes N/A for unavailable values, not blanks or zero', () => {
    const csv = toCsv([row({ trailingPE: null, dividendYieldPercent: null, currentPrice: null, rangePosition: null })]);
    const dataLine = csv.split('\r\n')[1];
    // P/E, 52W position, P/E and dividend yield should read N/A
    expect(dataLine).toContain('N/A');
  });

  it('preserves a real 0% dividend yield as 0.00%, distinct from N/A', () => {
    const csv = toCsv([row({ dividendYieldPercent: 0 })]);
    expect(csv.split('\r\n')[1]).toContain('0.00%');
  });

  it('quotes formatted currency values that contain commas', () => {
    const csv = toCsv([row({ currentPrice: 1234.5 })]);
    expect(csv).toContain('"$1,234.50"');
  });

  it('quotes company names containing commas', () => {
    const csv = toCsv([row({ companyName: 'Alphabet, Inc.' })]);
    expect(csv).toContain('"Alphabet, Inc."');
  });

  it('includes the per-row retrieval timestamp', () => {
    const csv = toCsv([row({})]);
    expect(csv).toContain('2026-06-19T20:00:00.000Z');
  });

  it('includes score evidence and methodology metadata for auditability', () => {
    const csv = toCsv([row({})]);
    expect(csv).toContain('Source,Strength,Risk,Data Coverage,Research Tier,Scoring Version');
    expect(csv.split('\r\n')[1]).toMatch(new RegExp(`\\d+/\\d+,\\d+/\\d+,\\d+/\\d+,(strong|moderate|weak),${SCORING_VERSION}$`));
  });
});
