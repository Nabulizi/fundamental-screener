import { createFinnhubProvider } from './finnhub';
import { createAlphaVantageProvider } from './alphavantage';
import { createFallbackProvider } from './fallbackProvider';
import type { QuoteProvider } from './provider';

/**
 * Assemble the live provider from env keys. SERVER-ONLY — reads FINNHUB_API_KEY
 * / ALPHAVANTAGE_API_KEY, so this module must never be imported into client code
 * (see CLAUDE.md: a bundled key could reach the browser).
 *
 * Finnhub is primary; multiple comma-separated Finnhub keys each register as a
 * separate provider for round-robin failover on rate limits. Alpha Vantage is
 * appended last as the final fallback when configured. Returns null when no
 * Finnhub key is configured.
 */
export function buildProvider(): QuoteProvider | null {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return null;

  const finnhubKeys = apiKey.split(',').map((k) => k.trim()).filter(Boolean);
  const providers: QuoteProvider[] = finnhubKeys.map((key) => createFinnhubProvider(key));
  const alphaVantageKey = process.env.ALPHAVANTAGE_API_KEY;
  if (alphaVantageKey) providers.push(createAlphaVantageProvider(alphaVantageKey));

  return providers.length > 1 ? createFallbackProvider(providers) : providers[0];
}

/** Cache TTL in seconds from CACHE_TTL_SECONDS (default 60). Shared so the scan
 *  API and the detail route honor the same operator-configured value. */
export function cacheTtlSeconds(): number {
  const parsed = Number(process.env.CACHE_TTL_SECONDS);
  return Number.isFinite(parsed) ? parsed : 60;
}
