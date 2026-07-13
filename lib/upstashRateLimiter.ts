import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import {
  MAX_REFRESH_TICKERS_PER_MINUTE,
  MAX_GLOBAL_TICKERS_PER_MINUTE,
  MAX_SCAN_TICKERS_PER_MINUTE,
  type RateLimitDecision,
  type ScanRateLimiter,
} from './requestGuard';

/** Concrete deployment-shared limiter for serverless/multi-instance hosting. */
export class UpstashScanRateLimiter implements ScanRateLimiter {
  private readonly scan: Ratelimit;
  private readonly refresh: Ratelimit;
  private readonly global: Ratelimit;

  constructor(redis: Redis) {
    this.scan = new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(MAX_SCAN_TICKERS_PER_MINUTE, '1 m'),
      prefix: 'fundamental-screener:scan',
      analytics: false,
      timeout: 1_500,
    });
    this.refresh = new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(MAX_REFRESH_TICKERS_PER_MINUTE, '1 m'),
      prefix: 'fundamental-screener:refresh',
      analytics: false,
      timeout: 1_500,
    });
    this.global = new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(MAX_GLOBAL_TICKERS_PER_MINUTE, '1 m'),
      prefix: 'fundamental-screener:provider-global',
      analytics: false,
      timeout: 1_500,
    });
  }

  async consume(key: string, kind: 'scan' | 'refresh', cost: number): Promise<RateLimitDecision> {
    const result = await (kind === 'refresh' ? this.refresh : this.scan).limit(key, { rate: cost });
    // The SDK can return success after its timeout. Throw so requestGuard applies
    // the bounded in-process fallback instead of silently becoming unlimited.
    if (result.reason === 'timeout') throw new Error('shared rate limiter timed out');
    const clientDecision = {
      allowed: result.success,
      retryAfterSeconds: result.success ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    };
    if (!clientDecision.allowed) return clientDecision;
    const global = await this.global.limit('provider', { rate: cost });
    if (global.reason === 'timeout') throw new Error('shared global rate limiter timed out');
    return {
      allowed: global.success,
      retryAfterSeconds: global.success ? 0 : Math.max(1, Math.ceil((global.reset - Date.now()) / 1000)),
    };
  }
}

export function upstashLimiterFromEnv(): ScanRateLimiter | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new UpstashScanRateLimiter(Redis.fromEnv());
}
