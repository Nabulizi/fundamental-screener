import type { ScanRow } from './types';

interface CacheEntry {
  row: ScanRow;
  expiresAt: number;
}

// Module-level in-memory cache. NOTE: on serverless platforms this is
// best-effort — each cold start / instance has its own map, so cache hits are
// not guaranteed across requests. Documented in the README.
const store = new Map<string, CacheEntry>();

/**
 * Return a cached row if present and unexpired. The cached row keeps its
 * ORIGINAL retrievedAt timestamp, so "last updated" never lies about freshness.
 */
export function getCached(ticker: string, now = Date.now()): ScanRow | null {
  const entry = store.get(ticker);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(ticker);
    return null;
  }
  return entry.row;
}

export function setCached(ticker: string, row: ScanRow, ttlSeconds: number, now = Date.now()): void {
  if (ttlSeconds <= 0) return;
  store.set(ticker, { row, expiresAt: now + ttlSeconds * 1000 });
}

export function clearCache(): void {
  store.clear();
}
