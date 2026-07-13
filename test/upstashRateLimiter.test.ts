import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstashScanRateLimiter, upstashLimiterFromEnv } from '@/lib/upstashRateLimiter';

describe('Upstash shared limiter configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('stays disabled unless both REST credentials are configured', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    expect(upstashLimiterFromEnv()).toBeNull();
  });

  it('constructs the concrete shared limiter from deployment credentials', () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    expect(upstashLimiterFromEnv()).toBeInstanceOf(UpstashScanRateLimiter);
  });
});
