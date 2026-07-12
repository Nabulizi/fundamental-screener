import { beforeEach, describe, expect, it } from 'vitest';
import { clearScanBudgets, consumeScanBudget } from '@/lib/requestGuard';

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
