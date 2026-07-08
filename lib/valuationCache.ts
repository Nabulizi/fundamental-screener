import type { ValuationProfile } from './valuation';

// Separate from lib/cache.ts (which is ScanRow-typed) — the screener cache stays
// simple and this holds the heavier per-company valuation profile. Same in-memory,
// best-effort-on-serverless caveat as cache.ts (per-instance map).
interface Entry {
  profile: ValuationProfile;
  expiresAt: number;
}

const store = new Map<string, Entry>();

export function getCachedValuation(ticker: string, now = Date.now()): ValuationProfile | null {
  const entry = store.get(ticker);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(ticker);
    return null;
  }
  return entry.profile;
}

export function setCachedValuation(ticker: string, profile: ValuationProfile, ttlSeconds: number, now = Date.now()): void {
  if (ttlSeconds <= 0) return;
  store.set(ticker, { profile, expiresAt: now + ttlSeconds * 1000 });
}

export function clearValuationCache(): void {
  store.clear();
}
