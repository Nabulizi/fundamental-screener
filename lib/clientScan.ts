import type { ScanError, ScanRow } from './types';

export interface ScanProgress {
  completed: number;
  total: number;
}

export interface ClientScanResult {
  rows: ScanRow[];
  errors: ScanError[];
  /** True when the scan was cancelled — rows/errors hold what completed. */
  aborted: boolean;
}

export interface ClientScanOptions {
  refresh?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
  /** Fired as each row arrives, in completion (not input) order. */
  onRow?: (row: ScanRow) => void;
  /** Fired as each per-ticker error arrives. */
  onError?: (error: ScanError) => void;
  fetchImpl?: typeof fetch;
}

interface ScanApiPayload {
  rows?: ScanRow[];
  errors?: ScanError[];
}

/**
 * Drive the scan one ticker at a time with bounded concurrency, reporting
 * "completed of total" progress as each finishes. Each request is independent,
 * so one failure never discards the others (partial results preserved). Output
 * order matches input order. Cancellation is graceful: an aborted signal stops
 * new requests, and the rows/errors that already completed are returned with
 * `aborted: true` — a cancelled scan keeps its partial results.
 */
export async function runClientScan(
  tickers: string[],
  opts: ClientScanOptions = {}
): Promise<ClientScanResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const total = tickers.length;
  let completed = 0;

  const rowByTicker = new Map<string, ScanRow>();
  const errorsByTicker = new Map<string, ScanError[]>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < tickers.length) {
      if (opts.signal?.aborted) return; // cancelled — start no further requests
      const ticker = tickers[cursor];
      cursor += 1;
      try {
        const res = await doFetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: ticker, refresh: opts.refresh === true }),
          signal: opts.signal
        });
        if (res.ok) {
          const payload = (await res.json()) as ScanApiPayload;
          for (const row of payload.rows ?? []) {
            rowByTicker.set(row.ticker, row);
            opts.onRow?.(row);
          }
          if (payload.errors && payload.errors.length > 0) {
            errorsByTicker.set(ticker, payload.errors);
            for (const e of payload.errors) opts.onError?.(e);
          }
        } else {
          const error: ScanError = { ticker, code: 'PROVIDER_ERROR', message: `Request failed (HTTP ${res.status}).` };
          errorsByTicker.set(ticker, [error]);
          opts.onError?.(error);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return; // cancelled mid-request
        const error: ScanError = { ticker, code: 'PROVIDER_ERROR', message: 'Network error.' };
        errorsByTicker.set(ticker, [error]);
        opts.onError?.(error);
      } finally {
        completed += 1;
        opts.onProgress?.({ completed, total });
      }
    }
  }

  const workerCount = Math.min(concurrency, total) || 1;
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const rows: ScanRow[] = [];
  const errors: ScanError[] = [];
  for (const ticker of tickers) {
    const row = rowByTicker.get(ticker);
    if (row) rows.push(row);
    const errs = errorsByTicker.get(ticker);
    if (errs) errors.push(...errs);
  }
  return { rows, errors, aborted: opts.signal?.aborted === true };
}
