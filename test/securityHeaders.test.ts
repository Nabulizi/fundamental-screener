import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs config without type declarations
import nextConfig from '../next.config.mjs';

// Contract test: the security headers shipped for every route must not be
// silently dropped or weakened during config/dependency changes.
describe('security headers', () => {
  it('applies the required headers to all routes', async () => {
    const rules = await nextConfig.headers();
    const allRoutes = rules.find((rule: { source: string }) => rule.source === '/(.*)');
    expect(allRoutes).toBeDefined();
    const headers = new Map<string, string>(
      allRoutes.headers.map((h: { key: string; value: string }) => [h.key, h.value])
    );

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
