import type { ScanError, ScanResponse, ScanRow } from './types';
import { ProviderError, type QuoteProvider } from './provider';
import { getCached, setCached } from './cache';

export interface ScanOptions {
  ttlSeconds?: number;
  concurrency?: number;
  useCache?: boolean;
  /** When true, bypass cache reads (force a fresh fetch) but still update the cache. */
  refresh?: boolean;
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

  async function worker(): Promise<void> {
    for (;;) {
      const ticker = queue.shift();
      if (ticker === undefined) return;
      try {
        const cachedRow = useCache && !refresh ? getCached(ticker) : null;
        if (cachedRow) {
          // Served from cache — keep its original retrievedAt, flag as cached.
          rows.push({ ...cachedRow, cached: true });
        } else {
          const row = await provider.fetchCompany(ticker);
          if (useCache) setCached(ticker, row, ttlSeconds);
          rows.push({ ...row, cached: false });
        }
      } catch (err) {
        errors.push(toScanError(ticker, err));
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

  return { rows, errors, lastUpdatedAt };
}
