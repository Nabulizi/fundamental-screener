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
  | 'score';

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
  'score'
];

function isMissing(value: number | null): boolean {
  return value == null || !Number.isFinite(value);
}

/**
 * Return a new array sorted by `key`/`dir`. Missing (null/non-finite) numeric
 * values always sort to the end regardless of direction, so "N/A" never
 * masquerades as the smallest or largest value.
 *
 * When sorting by 'score', pass a `scoreMap` mapping ticker → score.
 */
export function sortRows(rows: ScanRow[], key: SortKey, dir: SortDir, scoreMap?: Map<string, number>): ScanRow[] {
  const numeric = NUMERIC_KEYS.includes(key);
  return [...rows].sort((a, b) => {
    if (numeric) {
      const av = key === 'score' ? (scoreMap?.get(a.ticker) ?? null) : a[key as keyof ScanRow] as number | null;
      const bv = key === 'score' ? (scoreMap?.get(b.ticker) ?? null) : b[key as keyof ScanRow] as number | null;
      const am = isMissing(av);
      const bm = isMissing(bv);
      if (am && bm) return 0;
      if (am) return 1;
      if (bm) return -1;
      return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    }
    const rk = key as keyof ScanRow;
    const av = ((a[rk] as string | null) ?? '').toString();
    const bv = ((b[rk] as string | null) ?? '').toString();
    const cmp = av.localeCompare(bv);
    return dir === 'asc' ? cmp : -cmp;
  });
}
