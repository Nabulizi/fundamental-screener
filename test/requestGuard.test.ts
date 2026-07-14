import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientKey, clearScanBudgets, consumeScanBudget, setScanRateLimiter, takeScanBudget } from '@/lib/requestGuard';

describe('scan request budget', () => {
  beforeEach(() => clearScanBudgets());

  it('allows one full product-size scan within the provider-wide budget', () => {
    expect(consumeScanBudget('client', false, 1_000, 20)).toMatchObject({ allowed: true });
    expect(consumeScanBudget('client', false, 1_000)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });

  it('uses a stricter refresh budget and resets after the window', () => {
    expect(consumeScanBudget('client', true, 1_000, 20)).toMatchObject({ allowed: true });
    expect(consumeScanBudget('client', true, 1_000).allowed).toBe(false);
    expect(consumeScanBudget('client', true, 61_000).allowed).toBe(true);
  });

  it('the global provider pool cannot be bypassed by rotating client keys', () => {
    expect(consumeScanBudget('client-a', false, 1_000, 12).allowed).toBe(true);
    expect(consumeScanBudget('client-b', false, 1_000, 8).allowed).toBe(true);
    expect(consumeScanBudget('client-c', false, 1_000, 1).allowed).toBe(false);
  });

  it('only trusts an explicitly configured proxy header', () => {
    const req = new Request('http://localhost', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientKey(req, undefined)).toBe('anonymous-global');
    expect(clientKey(req, 'x-forwarded-for')).toMatch(/^ip:[a-f0-9]{24}$/);
    expect(clientKey(req, 'x-forwarded-for')).not.toContain('1.2.3.4');
    expect(clientKey(req, 'made-up-header')).toBe('anonymous-global');
  });
});

describe('pluggable shared limiter', () => {
  beforeEach(() => clearScanBudgets());
  afterEach(() => setScanRateLimiter(null));

  it('uses the in-process bucket when no shared limiter is registered', async () => {
    expect((await takeScanBudget('k', true, 20)).allowed).toBe(true);
    const denied = await takeScanBudget('k', true);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('delegates to a registered shared limiter with the right key and kind', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    setScanRateLimiter({ consume });
    expect(await takeScanBudget('1.2.3.4', true)).toEqual({ allowed: false, retryAfterSeconds: 17 });
    expect(consume).toHaveBeenCalledWith('1.2.3.4', 'refresh', 1);
    expect(await takeScanBudget('1.2.3.4', false)).toMatchObject({ allowed: false });
    expect(consume).toHaveBeenCalledWith('1.2.3.4', 'scan', 1);
    // In-process buckets untouched while the shared limiter answers.
    expect(consumeScanBudget('1.2.3.4', true).allowed).toBe(true);
  });

  it('falls back to the in-process bucket when the shared limiter fails', async () => {
    setScanRateLimiter({ consume: vi.fn().mockRejectedValue(new Error('redis down')) });
    expect((await takeScanBudget('k', true, 20)).allowed).toBe(true);
    expect((await takeScanBudget('k', true)).allowed).toBe(false);
  });
});
