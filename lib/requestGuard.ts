import { createHash, createHmac } from 'node:crypto';

/** Guard for the quota-bearing scan endpoint.
 *
 * The in-process token bucket below is the default and is sufficient for a
 * single-instance/self-hosted deployment. Multi-instance or serverless
 * deployments must register a shared limiter (e.g. Upstash/Redis) via
 * `setScanRateLimiter` from `instrumentation.ts`; the route consumes budgets
 * through `takeScanBudget`, which delegates to the registered limiter and
 * falls back to the in-process bucket if the shared limiter fails (fail-open
 * to local limiting, never to unlimited).
 */

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ScanRateLimiter {
  /** kind separates the scan and (stricter) refresh budgets. */
  consume(key: string, kind: 'scan' | 'refresh', cost: number): Promise<RateLimitDecision>;
}

let sharedLimiter: ScanRateLimiter | null = null;

/** Register a deployment-shared limiter (null restores the in-process default). */
export function setScanRateLimiter(limiter: ScanRateLimiter | null): void {
  sharedLimiter = limiter;
}

/** The route-facing entry point: shared limiter when registered, else local. */
export async function takeScanBudget(key: string, refresh: boolean, cost = 1): Promise<RateLimitDecision> {
  const boundedCost = Math.max(1, Math.floor(cost));
  if (sharedLimiter) {
    try {
      return await sharedLimiter.consume(key, refresh ? 'refresh' : 'scan', boundedCost);
    } catch {
      // Shared backend unavailable — degrade to the per-instance bucket so
      // requests stay bounded rather than unlimited or hard-failing.
    }
  }
  return consumeScanBudget(key, refresh, Date.now(), boundedCost);
}

interface Bucket {
  startedAt: number;
  count: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
/** Budgets are ticker-weighted, not HTTP-request-weighted. */
export const MAX_SCAN_TICKERS_PER_MINUTE = 60;
export const MAX_REFRESH_TICKERS_PER_MINUTE = 20;
export const MAX_GLOBAL_TICKERS_PER_MINUTE = Math.max(
  1,
  Math.floor(Number(process.env.PROVIDER_TICKER_BUDGET_PER_MINUTE) || 20)
);

export const MAX_SCAN_BODY_BYTES = 16 * 1024;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

const TRUSTED_IP_HEADERS = new Set([
  'cf-connecting-ip',
  'fly-client-ip',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'x-forwarded-for',
]);

/**
 * Resolve the client identity only from an explicitly trusted proxy header.
 * Deployments must configure a header that their edge overwrites/strips; blindly
 * trusting user-supplied X-Forwarded-For lets attackers rotate the bucket key.
 * With no trusted header configured, all anonymous traffic shares one safe
 * global bucket rather than silently accepting a spoofable identity.
 */
export function clientKey(request: Request, configuredHeader = process.env.RATE_LIMIT_TRUSTED_IP_HEADER): string {
  const header = configuredHeader?.trim().toLowerCase();
  if (!header || !TRUSTED_IP_HEADERS.has(header)) return 'anonymous-global';
  const value = firstHeaderValue(request.headers.get(header));
  if (!value) return 'anonymous-global';
  const salt = process.env.RATE_LIMIT_KEY_SALT;
  const digest = salt
    ? createHmac('sha256', salt).update(value).digest('hex')
    : createHash('sha256').update(value).digest('hex');
  return `ip:${digest.slice(0, 24)}`;
}

function consumeBucket(bucketKey: string, limit: number, now: number, cost: number): RateLimitDecision {
  const existing = buckets.get(bucketKey);
  const bucket = !existing || now - existing.startedAt >= WINDOW_MS
    ? { startedAt: now, count: 0 }
    : existing;
  if (bucket.count + cost > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + WINDOW_MS - now) / 1000)) };
  }
  bucket.count += cost;
  buckets.set(bucketKey, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function consumeScanBudget(key: string, refresh: boolean, now = Date.now(), cost = 1): RateLimitDecision {
  if (buckets.size > 10_000) {
    for (const [staleKey, stale] of buckets) {
      if (now - stale.startedAt >= WINDOW_MS) buckets.delete(staleKey);
    }
  }
  const bucketKey = `${key}:${refresh ? 'refresh' : 'scan'}`;
  const limit = refresh ? MAX_REFRESH_TICKERS_PER_MINUTE : MAX_SCAN_TICKERS_PER_MINUTE;
  const boundedCost = Math.max(1, Math.floor(cost));
  const client = consumeBucket(bucketKey, limit, now, boundedCost);
  if (!client.allowed) return client;
  // A separate deployment-wide pool protects provider quota even when an
  // attacker rotates client identities. A WAF remains the outer abuse layer.
  return consumeBucket('__provider-global__', MAX_GLOBAL_TICKERS_PER_MINUTE, now, boundedCost);
}

export function clearScanBudgets(): void {
  buckets.clear();
}
