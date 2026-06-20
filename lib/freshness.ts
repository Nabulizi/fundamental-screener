import type { ScanRow } from './types';

export type Freshness = 'fresh' | 'cached' | 'stale';

/** Rows older than this are considered stale and worth refreshing. */
export const STALE_MS = 15 * 60 * 1000;

/**
 * Classify a row's freshness from its retrieval time and cache flag:
 * - 'stale'  : older than STALE_MS (regardless of source)
 * - 'cached' : served from the server cache and still recent
 * - 'fresh'  : just fetched this scan
 * An unparseable timestamp is treated as 'fresh' (no false "stale" alarm).
 */
export function rowFreshness(row: Pick<ScanRow, 'retrievedAt' | 'cached'>, now: number = Date.now()): Freshness {
  const ts = Date.parse(row.retrievedAt);
  if (!Number.isFinite(ts)) return 'fresh';
  if (now - ts >= STALE_MS) return 'stale';
  return row.cached ? 'cached' : 'fresh';
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: 'Fresh',
  cached: 'Cached',
  stale: 'Stale'
};
