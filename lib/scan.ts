import type { ScanError, ScanResponse, ScanRow } from './types';
import { ProviderError, type QuoteProvider } from './provider';
import { getCached, setCached } from './cache';
import { isOpen, recordFailure, recordSuccess } from './circuitBreaker';

export interface ScanOptions {
  ttlSeconds?: number;
  concurrency?: number;
  useCache?: boolean;
  /** When true, bypass cache reads (force a fresh fetch) but still update the cache. */
  refresh?: boolean;
}

/**
 * In-flight coalescing (P1-E): concurrent requests for the same provider+ticker
 * share ONE provider call instead of each spending quota. The map is
 * module-level so duplicate work is deduplicated across simultaneous scans
 * (e.g. two clients scanning AAPL, or a scan racing a detail-page load).
 * Entries are removed as soon as the fetch settles — errors are shared with
 * every waiter but never cached here.
 */
const inFlight = new Map<string, Promise<ScanRow>>();

function fetchCoalesced(provider: QuoteProvider, ticker: string, telemetry: ScanTelemetry): Promise<ScanRow> {
  const key = `${provider.name}:${ticker}`;
  const existing = inFlight.get(key);
  if (existing) {
    telemetry.coalescedJoins += 1;
    return existing;
  }
  telemetry.providerCalls += 1;
  const pending = provider.fetchCompany(ticker).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

/** Per-scan provider-economics counters, reported on the ScanResponse. */
export interface ScanTelemetry {
  /** Provider fetches this scan initiated (spent quota). */
  providerCalls: number;
  /** Rows served from the TTL cache. */
  cacheHits: number;
  /** Fetches that joined another scan's identical in-flight call (spent no quota). */
  coalescedJoins: number;
  /** Tickers that ended in an error (including circuit-breaker skips). */
  failures: number;
}

function toScanError(ticker: string, err: unknown): ScanError {
  if (err instanceof ProviderError) {
    return { ticker, code: err.code, message: err.message };
  }
  return { ticker, code: 'PROVIDER_ERROR', message: `Unexpected error fetching "${ticker}".` };
}

/**
 * Fetch each ticker independently with bounded concurrency. One ticker failing
 * (not found, rate limited, provider error) never discards the others — its
 * failure is recorded in `errors` while successful rows are still returned.
 * Output order matches input order.
 */
export async function scanTickers(
  tickers: string[],
  provider: QuoteProvider,
  opts: ScanOptions = {}
): Promise<ScanResponse> {
  const ttlSeconds = opts.ttlSeconds ?? 60;
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  const useCache = opts.useCache ?? true;
  const refresh = opts.refresh ?? false;

  const rows: ScanRow[] = [];
  const errors: ScanError[] = [];
  const queue = [...tickers];
  const telemetry: ScanTelemetry = { providerCalls: 0, cacheHits: 0, coalescedJoins: 0, failures: 0 };

  async function worker(): Promise<void> {
    for (;;) {
      const ticker = queue.shift();
      if (ticker === undefined) return;
      try {
        // Circuit breaker: skip tickers that have failed too many times recently.
        if (isOpen(ticker)) {
          errors.push({ ticker, code: 'PROVIDER_ERROR', message: 'Skipped — too many recent failures (circuit open).' });
          continue;
        }
        const cachedRow = useCache && !refresh ? getCached(ticker) : null;
        if (cachedRow) {
          // Served from cache — keep its original retrievedAt, flag as cached.
          telemetry.cacheHits += 1;
          rows.push({ ...cachedRow, cached: true });
        } else {
          const row = await fetchCoalesced(provider, ticker, telemetry);
          if (useCache) setCached(ticker, row, ttlSeconds);
          rows.push({ ...row, cached: false });
          recordSuccess(ticker);
        }
      } catch (err) {
        telemetry.failures += 1;
        errors.push(toScanError(ticker, err));
        // NOT_FOUND is a permanent condition (bad ticker), not a transient failure.
        if (!(err instanceof ProviderError && err.code === 'NOT_FOUND')) {
          recordFailure(ticker);
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, tickers.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const order = new Map(tickers.map((t, i) => [t, i]));
  rows.sort((a, b) => (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0));
  errors.sort((a, b) => (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0));

  // ISO timestamps sort lexically in chronological order.
  const lastUpdatedAt = rows.length
    ? rows.map((r) => r.retrievedAt).sort().at(-1) ?? null
    : null;

  return { rows, errors, lastUpdatedAt, telemetry };
}
