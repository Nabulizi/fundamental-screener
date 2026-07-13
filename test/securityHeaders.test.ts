import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config.mjs';

// Contract test: the security headers shipped for every route must not be
// silently dropped or weakened during config/dependency changes.
describe('security headers', () => {
  it('applies the required headers to all routes', async () => {
    if (!nextConfig.headers) throw new Error('next.config.mjs no longer defines headers()');
    const rules = await nextConfig.headers();
    const allRoutes = rules.find((rule) => rule.source === '/(.*)');
    if (!allRoutes) throw new Error('catch-all header rule is missing');
    const headers = new Map(allRoutes.headers.map((h) => [h.key, h.value]));

    const csp = headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });
});
