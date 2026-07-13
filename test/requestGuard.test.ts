import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearScanBudgets, consumeScanBudget, setScanRateLimiter, takeScanBudget } from '@/lib/requestGuard';

describe('scan request budget', () => {
  beforeEach(() => clearScanBudgets());

  it('allows normal requests up to the per-minute budget', () => {
    for (let i = 0; i < 30; i++) expect(consumeScanBudget('client', false, 1_000)).toMatchObject({ allowed: true });
    expect(consumeScanBudget('client', false, 1_000)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });

  it('uses a stricter independent budget for refreshes and resets after the window', () => {
    for (let i = 0; i < 6; i++) expect(consumeScanBudget('client', true, 1_000)).toMatchObject({ allowed: true });
    expect(consumeScanBudget('client', true, 1_000).allowed).toBe(false);
    expect(consumeScanBudget('client', true, 61_000).allowed).toBe(true);
    expect(consumeScanBudget('other-client', true, 1_000).allowed).toBe(true);
  });
});

describe('pluggable shared limiter', () => {
  beforeEach(() => clearScanBudgets());
  afterEach(() => setScanRateLimiter(null));

  it('uses the in-process bucket when no shared limiter is registered', async () => {
    for (let i = 0; i < 6; i++) expect((await takeScanBudget('k', true)).allowed).toBe(true);
    const denied = await takeScanBudget('k', true);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('delegates to a registered shared limiter with the right key and kind', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    setScanRateLimiter({ consume });
    expect(await takeScanBudget('1.2.3.4', true)).toEqual({ allowed: false, retryAfterSeconds: 17 });
    expect(consume).toHaveBeenCalledWith('1.2.3.4', 'refresh');
    expect(await takeScanBudget('1.2.3.4', false)).toMatchObject({ allowed: false });
    expect(consume).toHaveBeenCalledWith('1.2.3.4', 'scan');
    // In-process buckets untouched while the shared limiter answers.
    expect(consumeScanBudget('1.2.3.4', true).allowed).toBe(true);
  });

  it('falls back to the in-process bucket when the shared limiter fails', async () => {
    setScanRateLimiter({ consume: vi.fn().mockRejectedValue(new Error('redis down')) });
    for (let i = 0; i < 6; i++) expect((await takeScanBudget('k', true)).allowed).toBe(true);
    expect((await takeScanBudget('k', true)).allowed).toBe(false);
  });
});
