/** Small in-process guard for the quota-bearing scan endpoint.
 *
 * This is a useful baseline for a self-hosted instance, not a substitute for
 * an edge/shared limiter in a multi-instance deployment. The route exposes the
 * retry window so a real Redis/edge adapter can replace this module later.
 */

interface Bucket {
  startedAt: number;
  count: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const MAX_REFRESHES = 6;

export const MAX_SCAN_BODY_BYTES = 16 * 1024;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

export function clientKey(request: Request): string {
  // Prefer the platform-provided forwarding headers. If none exist, the
  // connection is still grouped under a stable local key.
  return firstHeaderValue(request.headers.get('x-forwarded-for'))
    ?? firstHeaderValue(request.headers.get('x-real-ip'))
    ?? 'local-client';
}

export function consumeScanBudget(key: string, refresh: boolean, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  if (buckets.size > 10_000) {
    for (const [staleKey, stale] of buckets) {
      if (now - stale.startedAt >= WINDOW_MS) buckets.delete(staleKey);
    }
  }
  const bucketKey = `${key}:${refresh ? 'refresh' : 'scan'}`;
  const limit = refresh ? MAX_REFRESHES : MAX_REQUESTS;
  const existing = buckets.get(bucketKey);
  const bucket = !existing || now - existing.startedAt >= WINDOW_MS
    ? { startedAt: now, count: 0 }
    : existing;
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + WINDOW_MS - now) / 1000)) };
  }
  bucket.count += 1;
  buckets.set(bucketKey, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearScanBudgets(): void {
  buckets.clear();
}
