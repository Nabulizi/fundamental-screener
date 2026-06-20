import type { ScanRow } from './types';

export type SortKey =
  | 'ticker'
  | 'companyName'
  | 'marketCap'
  | 'currentPrice'
  | 'trailingPE'
  | 'dividendYieldPercent'
  | 'week52High'
  | 'week52Low';

export type SortDir = 'asc' | 'desc';

const NUMERIC_KEYS: SortKey[] = [
  'marketCap',
  'currentPrice',
  'trailingPE',
  'dividendYieldPercent',
  'week52High',
  'week52Low'
];

function isMissing(value: number | null): boolean {
  return value == null || !Number.isFinite(value);
}

/**
 * Return a new array sorted by `key`/`dir`. Missing (null/non-finite) numeric
 * values always sort to the end regardless of direction, so "N/A" never
 * masquerades as the smallest or largest value.
 */
export function sortRows(rows: ScanRow[], key: SortKey, dir: SortDir): ScanRow[] {
  const numeric = NUMERIC_KEYS.includes(key);
  return [...rows].sort((a, b) => {
    if (numeric) {
      const av = a[key] as number | null;
      const bv = b[key] as number | null;
      const am = isMissing(av);
      const bm = isMissing(bv);
      if (am && bm) return 0;
      if (am) return 1;
      if (bm) return -1;
      return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    }
    const av = ((a[key] as string | null) ?? '').toString();
    const bv = ((b[key] as string | null) ?? '').toString();
    const cmp = av.localeCompare(bv);
    return dir === 'asc' ? cmp : -cmp;
  });
}
