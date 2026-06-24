import type { ScanRow } from './types';
import { ProviderError, type QuoteProvider } from './provider';
import { fetchWithRateLimitRetry, type RetryOptions } from './retry';
import { computeRangePosition } from './range';

const BASE_URL = 'https://finnhub.io/api/v1';

// ---------------------------------------------------------------------------
// Finnhub field map (confirm with `npm run probe` once a key is configured)
//
//  /stock/profile2?symbol=TICKER
//    name                 -> companyName
//    finnhubIndustry      -> industry
//    marketCapitalization -> marketCap  (DOCUMENTED UNIT: millions of `currency`;
//                            we multiply by 1e6 to store raw units)
//    currency             -> currency
//
//  /stock/metric?symbol=TICKER&metric=all  (fields live under `metric`)
//    52WeekHigh                   -> week52High
//    52WeekLow                    -> week52Low
//    peTTM                        -> trailingPE (non-positive normalized to null)
//    dividendYieldIndicatedAnnual -> dividendYieldPercent
//                            (DOCUMENTED UNIT: already a percentage, e.g. 3.05 = 3.05%)
//
// The two unit-sensitive assumptions — market cap in millions, dividend yield as
// a percentage — are isolated in normalizeFinnhub() below and covered by tests.
// ---------------------------------------------------------------------------

interface FinnhubProfile {
  name?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number;
  currency?: string;
  exchange?: string;
  ticker?: string;
}

// Substrings identifying US trading venues. Finnhub's `currency` field is the
// company's financial-REPORTING currency, which differs from the TRADING
// currency for ADRs (e.g. Alibaba reports in CNY but trades on the NYSE in USD).
// Market cap and 52-week prices are in the trading currency, so for US-listed
// symbols we label them USD regardless of the reporting currency.
const US_EXCHANGE_HINTS = ['NASDAQ', 'NEW YORK STOCK EXCHANGE', 'NYSE', 'AMEX', 'ARCA', 'BATS', 'CBOE', 'OTC'];

function resolveTradingCurrency(exchange: string | null, reportingCurrency: string | null): string | null {
  if (exchange) {
    const upper = exchange.toUpperCase();
    if (US_EXCHANGE_HINTS.some((hint) => upper.includes(hint))) return 'USD';
  }
  return reportingCurrency;
}

interface FinnhubMetricResponse {
  metric?: Record<string, unknown>;
}

// /quote?symbol=TICKER -> { c: current price, h, l, o, pc, t }. `c` is the
// current price in the trading currency. Confirm with `npm run probe`.
interface FinnhubQuote {
  c?: number;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure normalization from Finnhub's wire format into a ScanRow. Kept separate
 * from any network code so it can be unit-tested with fixtures (including the
 * negative-earnings / no-dividend cases). Every field is always present; `null`
 * means unavailable, while a genuine 0 from the provider is preserved.
 */
export function normalizeFinnhub(
  ticker: string,
  profile: FinnhubProfile,
  metric: Record<string, unknown>,
  retrievedAt: string,
  quote: FinnhubQuote | null = null
): ScanRow {
  const marketCapMillions = toNumber(profile.marketCapitalization);
  const peTtm = toNumber(metric['peTTM']);
  const forwardPeRaw = toNumber(metric['forwardPE']);
  const ytdRaw = toNumber(metric['yearToDatePriceReturnDaily']);
  const low = toNumber(metric['52WeekLow']);
  const high = toNumber(metric['52WeekHigh']);
  // FCF Yield = 1 / (Price/FCF) * 100. pfcfShareTTM is Price/FCF per share.
  const pfcf = toNumber(metric['pfcfShareTTM']);
  const revenueGrowthRaw = toNumber(metric['revenueGrowthTTMYoy']);
  const debtEquityRaw = toNumber(metric['totalDebt/totalEquityQuarterly']);
  const evEbitdaRaw = toNumber(metric['evEbitdaTTM']);
  // A real stock price is never <= 0; treat that as "no price" (unavailable).
  const rawPrice = toNumber(quote?.c);
  const currentPrice = rawPrice != null && rawPrice > 0 ? rawPrice : null;

  return {
    ticker,
    companyName: toText(profile.name),
    industry: toText(profile.finnhubIndustry),
    // Documented as millions; convert to raw currency units.
    marketCap: marketCapMillions == null ? null : marketCapMillions * 1_000_000,
    // Trading currency (USD for US-listed ADRs), not the reporting currency.
    currency: resolveTradingCurrency(toText(profile.exchange), toText(profile.currency)),
    week52Low: low,
    week52High: high,
    // Negative / zero P/E (unprofitable) is not a meaningful trailing P/E.
    trailingPE: peTtm != null && peTtm > 0 ? peTtm : null,
    // Forward P/E from consensus estimates. Non-positive is meaningless.
    forwardPE: forwardPeRaw != null && forwardPeRaw > 0 ? forwardPeRaw : null,
    // Already a percentage per Finnhub docs. A real 0 (non-payer) is preserved.
    dividendYieldPercent: toNumber(metric['dividendYieldIndicatedAnnual']),
    ytdReturn: ytdRaw,
    // FCF Yield = 100 / Price-to-FCF ratio. Only meaningful when P/FCF > 0.
    fcfYieldPercent: pfcf != null && pfcf > 0 ? 100 / pfcf : null,
    revenueGrowthTTM: revenueGrowthRaw,
    debtToEquity: debtEquityRaw != null && debtEquityRaw >= 0 ? debtEquityRaw : null,
    evToEbitda: evEbitdaRaw != null && evEbitdaRaw > 0 ? evEbitdaRaw : null,
    currentPrice,
    // Raw (unclamped) position; null when price or range is unavailable/invalid.
    rangePosition: computeRangePosition(currentPrice, low, high),
    retrievedAt
  };
}

function isEmptyProfile(profile: FinnhubProfile): boolean {
  // Finnhub returns `{}` for unknown symbols.
  return !profile || (Object.keys(profile).length === 0) || (!profile.name && !profile.ticker);
}

function buildUrl(path: string, apiKey: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${BASE_URL}${path}${sep}token=${encodeURIComponent(apiKey)}`;
}

export function createFinnhubProvider(apiKey: string, retryOpts: RetryOptions = {}): QuoteProvider {
  const init: RequestInit = { headers: { Accept: 'application/json' } };

  return {
    name: 'finnhub',
    async fetchCompany(ticker: string, signal?: AbortSignal): Promise<ScanRow> {
      const retrievedAt = new Date().toISOString();
      const reqInit = signal ? { ...init, signal } : init;

      let profileRes: Response;
      let metricRes: Response;
      let quoteRes: Response;
      try {
        [profileRes, metricRes, quoteRes] = await Promise.all([
          fetchWithRateLimitRetry(buildUrl(`/stock/profile2?symbol=${encodeURIComponent(ticker)}`, apiKey), reqInit, retryOpts),
          fetchWithRateLimitRetry(buildUrl(`/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`, apiKey), reqInit, retryOpts),
          fetchWithRateLimitRetry(buildUrl(`/quote?symbol=${encodeURIComponent(ticker)}`, apiKey), reqInit, retryOpts)
        ]);
      } catch (err) {
        throw new ProviderError('PROVIDER_ERROR', `Network error while fetching "${ticker}".`);
      }

      if (profileRes.status === 429 || metricRes.status === 429) {
        throw new ProviderError('RATE_LIMITED', 'Rate limit reached. Please try again shortly.');
      }
      if (!profileRes.ok) {
        throw new ProviderError('PROVIDER_ERROR', `Provider error for "${ticker}" (HTTP ${profileRes.status}).`);
      }

      const profile = (await profileRes.json()) as FinnhubProfile;
      if (isEmptyProfile(profile)) {
        throw new ProviderError('NOT_FOUND', `No company data found for "${ticker}".`);
      }

      // Metrics and quote are best-effort: if they fail we still return the row
      // with those fields as null rather than dropping the whole ticker.
      let metric: Record<string, unknown> = {};
      if (metricRes.ok) {
        const parsed = (await metricRes.json()) as FinnhubMetricResponse;
        metric = parsed.metric ?? {};
      }

      let quote: FinnhubQuote | null = null;
      if (quoteRes.ok) {
        quote = (await quoteRes.json()) as FinnhubQuote;
      }

      return normalizeFinnhub(ticker, profile, metric, retrievedAt, quote);
    }
  };
}
