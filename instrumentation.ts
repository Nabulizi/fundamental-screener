export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ setScanRateLimiter }, { upstashLimiterFromEnv }] = await Promise.all([
    import('./lib/requestGuard'),
    import('./lib/upstashRateLimiter'),
  ]);
  setScanRateLimiter(upstashLimiterFromEnv());
}
