import { describe, it, expect, vi } from 'vitest';
import { parseRetryAfter, fetchWithRateLimitRetry } from '@/lib/retry';

function res(status: number, retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set('retry-after', retryAfter);
  return new Response(null, { status, headers });
}

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
  });
  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-06-19T20:00:00.000Z');
    const future = 'Fri, 19 Jun 2026 20:00:30 GMT';
    expect(parseRetryAfter(future, now)).toBe(30_000);
  });
  it('returns null for missing/garbage', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('fetchWithRateLimitRetry', () => {
  it('retries exactly once on 429, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(429, '0'))
      .mockResolvedValueOnce(res(200));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const out = await fetchWithRateLimitRetry('http://x', {}, { fetchImpl, sleep, jitter: () => 0 });
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry more than once (returns the second 429)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(429, '0'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const out = await fetchWithRateLimitRetry('http://x', {}, { fetchImpl, sleep, jitter: () => 0 });
    expect(out.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-429 responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(500));
    const sleep = vi.fn();
    const out = await fetchWithRateLimitRetry('http://x', {}, { fetchImpl, sleep });
    expect(out.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('caps the Retry-After wait', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(429, '9999')).mockResolvedValueOnce(res(200));
    let waited = -1;
    const sleep = vi.fn().mockImplementation((ms: number) => {
      waited = ms;
      return Promise.resolve();
    });
    await fetchWithRateLimitRetry('http://x', {}, { fetchImpl, sleep, jitter: () => 0, capMs: 5_000 });
    expect(waited).toBe(5_000);
  });
});
