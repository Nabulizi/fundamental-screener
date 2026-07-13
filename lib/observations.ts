import type { ScanRow } from './types';
import type { CrossCheck } from './crossCheck';
import { sanitizeRevenueGrowth, sanitizeQuarterlyRevGrowth, EXTREME_DE_RATIO } from './scoring';

/**
 * Field-level provenance for the metrics the UI displays (P1-A/B/C).
 *
 * The row stays a flat ScanRow; this module derives an ADJACENT metadata map
 * rather than wrapping every value. That works because for both current
 * providers the semantics of each field — period basis, unit, source field,
 * reported vs computed — are static per provider (they're the verified field
 * map in the README). Only three things vary per row: which provider produced
 * it, when it was retrieved, and what quality flags the values earn.
 *
 * `effectiveAt` is honest about a real limitation: neither Finnhub's
 * /stock/metric nor Alpha Vantage's OVERVIEW reports when the underlying
 * figures became true (filing date, estimate vintage, quote time). It is null
 * for every field today, and the UI must therefore never present retrievedAt
 * as data currency. When a provider that supplies as-of dates is added, its
 * adapter fills this in.
 */

export type MetricKey =
  | 'marketCap' | 'currentPrice' | 'week52Range' | 'ytdReturn'
  | 'trailingPE' | 'forwardPE' | 'dividendYieldPercent' | 'fcfYieldPercent'
  | 'revenueGrowthTTM' | 'debtToEquity' | 'evToEbitda';

export type MetricPeriod = 'instant' | 'quarter' | 'ttm' | 'annual' | 'forward' | 'trailing-52w';

export type QualityFlag =
  | 'missing'            // provider gave no usable value
  | 'implausible'        // outside sanity bounds; scoring neutralizes it
  | 'single-source'      // no independent second source has confirmed it
  | 'secondary-disagrees'; // the second source materially differs (detail page)

export interface MetricObservation {
  key: MetricKey;
  label: string;
  value: number | null;
  source: 'finnhub' | 'alphavantage' | null;
  sourceField: string | null;
  retrievedAt: string;
  /** When the figure became economically true. Unavailable from current providers. */
  effectiveAt: string | null;
  period: MetricPeriod;
  unit: 'currency' | 'percent' | 'ratio';
  currency: string | null;
  reportedOrComputed: 'reported' | 'provider-computed' | 'app-computed';
  qualityFlags: QualityFlag[];
}

interface FieldSemantics {
  label: string;
  period: MetricPeriod;
  unit: MetricObservation['unit'];
  reportedOrComputed: MetricObservation['reportedOrComputed'];
  /** Provider wire field, per the probe-verified README field map. */
  sourceField: { finnhub: string; alphavantage: string | null };
  value: (row: ScanRow) => number | null;
}

export const FIELD_SEMANTICS: Record<MetricKey, FieldSemantics> = {
  marketCap: {
    label: 'Market cap', period: 'instant', unit: 'currency', reportedOrComputed: 'reported',
    sourceField: { finnhub: 'profile2.marketCapitalization', alphavantage: 'OVERVIEW.MarketCapitalization' },
    value: (r) => r.marketCap
  },
  currentPrice: {
    label: 'Price', period: 'instant', unit: 'currency', reportedOrComputed: 'reported',
    sourceField: { finnhub: 'quote.c', alphavantage: 'GLOBAL_QUOTE.05. price' },
    value: (r) => r.currentPrice ?? null
  },
  week52Range: {
    label: '52-week range', period: 'trailing-52w', unit: 'currency', reportedOrComputed: 'reported',
    sourceField: { finnhub: 'metric.52WeekLow/High', alphavantage: 'OVERVIEW.52WeekLow/High' },
    // The range cell renders low/high; observe the high as the representative value.
    value: (r) => r.week52High
  },
  ytdReturn: {
    label: 'YTD return', period: 'instant', unit: 'percent', reportedOrComputed: 'provider-computed',
    sourceField: { finnhub: 'metric.yearToDatePriceReturnDaily', alphavantage: null },
    value: (r) => r.ytdReturn
  },
  trailingPE: {
    label: 'P/E (TTM)', period: 'ttm', unit: 'ratio', reportedOrComputed: 'provider-computed',
    sourceField: { finnhub: 'metric.peTTM', alphavantage: 'OVERVIEW.PERatio' },
    value: (r) => r.trailingPE
  },
  forwardPE: {
    label: 'P/E (forward)', period: 'forward', unit: 'ratio', reportedOrComputed: 'provider-computed',
    sourceField: { finnhub: 'metric.forwardPE', alphavantage: 'OVERVIEW.ForwardPE' },
    value: (r) => r.forwardPE
  },
  dividendYieldPercent: {
    label: 'Dividend yield', period: 'ttm', unit: 'percent', reportedOrComputed: 'provider-computed',
    sourceField: { finnhub: 'metric.dividendYieldIndicatedAnnual', alphavantage: 'OVERVIEW.DividendYield' },
    value: (r) => r.dividendYieldPercent
  },
  fcfYieldPercent: {
    label: 'FCF yield', period: 'ttm', unit: 'percent', reportedOrComputed: 'app-computed',
    sourceField: { finnhub: 'metric.pfcfShareTTM (inverted)', alphavantage: null },
    value: (r) => r.fcfYieldPercent
  },
  revenueGrowthTTM: {
    label: 'Revenue growth (TTM YoY)', period: 'ttm', unit: 'percent', reportedOrComputed: 'provider-computed',
    sourceField: { finnhub: 'metric.revenueGrowthTTMYoy', alphavantage: null },
    value: (r) => r.revenueGrowthTTM
  },
  debtToEquity: {
    label: 'Debt / equity', period: 'quarter', unit: 'ratio', reportedOrComputed: 'provider-computed',
    sourceField: { finnhub: 'metric.totalDebt/totalEquityQuarterly', alphavantage: null },
    value: (r) => r.debtToEquity
  },
  evToEbitda: {
    label: 'EV / EBITDA', period: 'ttm', unit: 'ratio', reportedOrComputed: 'provider-computed',
    sourceField: { finnhub: 'metric.evEbitdaTTM', alphavantage: null },
    value: (r) => r.evToEbitda
  }
};

export const METRIC_KEYS = Object.keys(FIELD_SEMANTICS) as MetricKey[];

/** Human copy for the period basis — used by tooltips and the sources panel. */
export const PERIOD_LABEL: Record<MetricPeriod, string> = {
  instant: 'point-in-time quote/valuation',
  quarter: 'most recent reported quarter',
  ttm: 'trailing twelve months',
  annual: 'latest annual report',
  forward: 'analyst consensus estimate',
  'trailing-52w': 'trailing 52-week window'
};

/** Value-level plausibility checks for score-driving fields (P1-C). */
export function plausibilityFlags(key: MetricKey, row: ScanRow): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const v = FIELD_SEMANTICS[key].value(row);
  if (v == null) return ['missing'];
  switch (key) {
    case 'revenueGrowthTTM':
      if (sanitizeRevenueGrowth(row).suspect || sanitizeQuarterlyRevGrowth(row).suspect) flags.push('implausible');
      break;
    case 'debtToEquity':
      // Negative or extreme book equity makes the ratio noise; scoring
      // arbitrates via interest coverage but the value itself is suspect.
      if (v < 0 || v > EXTREME_DE_RATIO) flags.push('implausible');
      break;
    case 'dividendYieldPercent':
      if (v < 0 || v > 25) flags.push('implausible');
      break;
    case 'fcfYieldPercent':
      if (Math.abs(v) > 100) flags.push('implausible');
      break;
    case 'trailingPE':
    case 'forwardPE':
      if (v > 1_000) flags.push('implausible');
      break;
    case 'marketCap':
    case 'currentPrice':
      if (v <= 0) flags.push('implausible');
      break;
  }
  return flags;
}

/**
 * Build the per-metric observation map for a row. `crossCheck` (detail page
 * only) upgrades confirmed fields from 'single-source' and flags material
 * disagreement; without it every present value is single-source.
 */
export function observeRow(row: ScanRow, crossCheck?: CrossCheck | null): MetricObservation[] {
  return METRIC_KEYS.map((key) => {
    const s = FIELD_SEMANTICS[key];
    const value = s.value(row);
    const qualityFlags = plausibilityFlags(key, row);
    if (value != null) {
      const checked = crossCheck?.available ? crossCheck.fields.find((f) => f.key === key) : undefined;
      if (checked?.status === 'differ') qualityFlags.push('secondary-disagrees');
      if (!checked || checked.status === 'unavailable') qualityFlags.push('single-source');
    }
    return {
      key,
      label: s.label,
      value,
      source: row.source ?? null,
      sourceField: row.source ? s.sourceField[row.source] : s.sourceField.finnhub,
      retrievedAt: row.retrievedAt,
      effectiveAt: null,
      period: s.period,
      unit: s.unit,
      currency: s.unit === 'currency' ? row.currency : null,
      reportedOrComputed: s.reportedOrComputed,
      qualityFlags
    };
  });
}
