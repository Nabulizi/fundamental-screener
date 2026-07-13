import type { ScanRow } from './types';
import { formatMarketCap, formatCurrency, formatPercent, formatReturn, formatPe, formatRatio, NA } from './format';
import { clampFraction } from './range';
import { scoreRow, SCORING_VERSION, MAX_RISK, MAX_STRENGTH } from './scoring';

const HEADERS = [
  'Ticker',
  'Company',
  'Industry',
  'Market Cap',
  'Price',
  '52W Low',
  '52W High',
  '52W Position',
  'P/E (TTM)',
  'P/E (Fwd)',
  'Dividend Yield',
  'YTD Return',
  'FCF Yield',
  'Revenue Growth (TTM)',
  'D/E',
  'EV/EBITDA',
  'Retrieved At (UTC)',
  'Source',
  'Strength',
  'Risk',
  'Data Coverage',
  'Research Tier',
  'Scoring Version'
];

/** RFC 4180 field escaping: quote fields containing comma, quote, or newline. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rangePositionCell(position: number | null | undefined): string {
  if (position == null || !Number.isFinite(position)) return NA;
  return formatPercent(clampFraction(position) * 100);
}

/**
 * Build a CSV of the displayed rows. Values are formatted exactly as shown in
 * the UI (B/M/T, currency, percentages), unavailable values are written as
 * "N/A", and each row carries its own retrieval timestamp. Rows are emitted in
 * the order given (i.e. respect the current filter + sort).
 */
export function toCsv(rows: ScanRow[]): string {
  const lines: string[] = [HEADERS.map(escapeCsvField).join(',')];

  for (const r of rows) {
    const scored = scoreRow(r);
    const cells = [
      r.ticker,
      r.companyName ?? NA,
      r.industry ?? NA,
      formatMarketCap(r.marketCap, r.currency),
      formatCurrency(r.currentPrice ?? null, r.currency),
      formatCurrency(r.week52Low, r.currency),
      formatCurrency(r.week52High, r.currency),
      rangePositionCell(r.rangePosition),
      formatPe(r.trailingPE),
      formatPe(r.forwardPE),
      formatPercent(r.dividendYieldPercent),
      formatReturn(r.ytdReturn),
      formatPercent(r.fcfYieldPercent),
      formatReturn(r.revenueGrowthTTM),
      formatRatio(r.debtToEquity),
      formatRatio(r.evToEbitda),
      r.retrievedAt,
      r.source ?? NA,
      `${scored.strengthScore}/${MAX_STRENGTH}`,
      `${scored.riskScore}/${MAX_RISK}`,
      `${scored.coverage.covered}/${scored.coverage.applicable}`,
      scored.tier,
      String(SCORING_VERSION)
    ];
    lines.push(cells.map((c) => escapeCsvField(String(c))).join(','));
  }

  return lines.join('\r\n');
}
