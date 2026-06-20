export interface RetryOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  /** Upper bound applied to any Retry-After wait, in ms (default 10s). */
  capMs?: number;
}

const DEFAULT_CAP_MS = 10_000;
const DEFAULT_WAIT_MS = 1_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse an HTTP `Retry-After` header. Supports both delta-seconds ("120") and
 * an HTTP-date. Returns a non-negative millisecond delay, or null if absent /
 * unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (value == null || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - now);
  }
  return null;
}

/**
 * Fetch a URL with a single retry on HTTP 429 only. The retry honors
 * Retry-After (seconds or HTTP-date), caps the wait, and adds small jitter to
 * avoid synchronized retries. All other statuses (including the second 429) are
 * returned to the caller to map as it sees fit.
 */
export async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const jitter = opts.jitter ?? (() => Math.random() * 250);
  const capMs = opts.capMs ?? DEFAULT_CAP_MS;

  let response = await doFetch(url, init);
  if (response.status !== 429) return response;

  const retryAfter = parseRetryAfter(response.headers.get('retry-after'), now());
  const wait = Math.min(retryAfter ?? DEFAULT_WAIT_MS, capMs) + jitter();
  await sleep(wait);

  // Exactly one retry — never loop, to avoid worsening rate limiting.
  return doFetch(url, init);
}
