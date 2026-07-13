import type { ScanRow } from './types';

export type SortKey =
  | 'ticker'
  | 'companyName'
  | 'marketCap'
  | 'currentPrice'
  | 'trailingPE'
  | 'forwardPE'
  | 'dividendYieldPercent'
  | 'ytdReturn'
  | 'fcfYieldPercent'
  | 'revenueGrowthTTM'
  | 'debtToEquity'
  | 'evToEbitda'
  | 'week52High'
  | 'week52Low'
  | 'strength'
  | 'risk'
  | 'coverage';

export type SortDir = 'asc' | 'desc';

const NUMERIC_KEYS: SortKey[] = [
  'marketCap',
  'currentPrice',
  'trailingPE',
  'forwardPE',
  'dividendYieldPercent',
  'ytdReturn',
  'fcfYieldPercent',
  'revenueGrowthTTM',
  'debtToEquity',
  'evToEbitda',
  'week52High',
  'week52Low',
  'strength',
  'risk',
  'coverage'
];

function isMissing(value: number | null): boolean {
  return value == null || !Number.isFinite(value);
}

/**
 * Return a new array sorted by `key`/`dir`. Missing (null/non-finite) numeric
 * values always sort to the end regardless of direction, so "N/A" never
 * masquerades as the smallest or largest value.
 *
 * Strength, risk, and coverage are derived from the scoring map passed by the
 * caller. They stay separate so a high Strength row cannot hide material risk.
 */
export interface SortMetrics {
  strength: number;
  risk: number;
  coverage: number;
}

export function sortRows(rows: ScanRow[], key: SortKey, dir: SortDir, scoreMap?: Map<string, SortMetrics>): ScanRow[] {
  const numeric = NUMERIC_KEYS.includes(key);
  return [...rows].sort((a, b) => {
    if (numeric) {
      const av = (key === 'strength' || key === 'risk' || key === 'coverage')
        ? (scoreMap?.get(a.ticker)?.[key] ?? null)
        : a[key as keyof ScanRow] as number | null;
      const bv = (key === 'strength' || key === 'risk' || key === 'coverage')
        ? (scoreMap?.get(b.ticker)?.[key] ?? null)
        : b[key as keyof ScanRow] as number | null;
      const am = isMissing(av);
      const bm = isMissing(bv);
      if (am && bm) return 0;
      if (am) return 1;
      if (bm) return -1;
      const cmp = dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
      if (cmp !== 0) return cmp;
      return a.ticker.localeCompare(b.ticker);
    }
    const rk = key as keyof ScanRow;
    const av = ((a[rk] as string | null) ?? '').toString();
    const bv = ((b[rk] as string | null) ?? '').toString();
    const cmp = av.localeCompare(bv);
    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    return a.ticker.localeCompare(b.ticker);
  });
}
