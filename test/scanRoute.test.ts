import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/scan/route';
import { clearScanBudgets, consumeScanBudget, setScanRateLimiter } from '@/lib/requestGuard';

// API-level guard behavior. Rejected requests never reach a provider.
function scanRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

describe('POST /api/scan guard behavior', () => {
  beforeEach(() => clearScanBudgets());
  afterEach(() => setScanRateLimiter(null));

  it('rejects a declared oversized body with 413 before reading it', async () => {
    const res = await POST(scanRequest({ input: '' }, { 'content-length': '99999' }));
    expect(res.status).toBe(413);
  });

  it('rejects an undeclared oversized body with 400 after the byte check', async () => {
    const res = await POST(scanRequest({ input: '', pad: 'x'.repeat(20_000) }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed bodies with 400 and no-store', async () => {
    const res = await POST(scanRequest('not json'));
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 429 with Retry-After once the refresh budget is exhausted', async () => {
    expect(consumeScanBudget('anonymous-global', true, Date.now(), 20).allowed).toBe(true);
    const denied = await POST(scanRequest({ input: 'AAPL', refresh: true }));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get('Cache-Control')).toBe('no-store');
  });

  it('honors a registered shared limiter at the route level', async () => {
    setScanRateLimiter({ consume: async () => ({ allowed: false, retryAfterSeconds: 42 }) });
    const res = await POST(scanRequest({ input: 'AAPL' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
  });
});
