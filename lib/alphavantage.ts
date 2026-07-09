import type { ScanRow } from './types';
import { ProviderError, type QuoteProvider } from './provider';
import { fetchWithRateLimitRetry, type RetryOptions } from './retry';
import { computeRangePosition } from './range';

const BASE_URL = 'https://www.alphavantage.co/query';

// ---------------------------------------------------------------------------
// Alpha Vantage field map (confirm with `npm run probe` once a key is configured)
//
//  function=OVERVIEW&symbol=TICKER  (one call returns all fundamentals)
//    Name                 -> companyName
//    Industry (or Sector) -> industry
//    MarketCapitalization -> marketCap   (DOCUMENTED UNIT: RAW currency units)
//    TrailingPE / PERatio -> trailingPE
//    DividendYield        -> dividendYieldPercent
//        (DOCUMENTED UNIT: a DECIMAL fraction, e.g. 0.0305 = 3.05% — so x100)
//    52WeekHigh / 52WeekLow -> week52High / week52Low
//    Currency             -> currency
//
//  function=GLOBAL_QUOTE&symbol=TICKER
//    "Global Quote"["05. price"] -> currentPrice
//
// Alpha Vantage returns numbers as STRINGS and uses "None"/"-"/"" for missing
// values. On the free tier a daily/minute limit returns HTTP 200 with a "Note"
// or "Information" message instead of data — treated here as RATE_LIMITED so the
// fallback can react. Raw-market-cap and decimal-yield are isolated below.
// ---------------------------------------------------------------------------

interface AvOverview {
  Symbol?: string;
  Name?: string;
  Sector?: string;
  Industry?: string;
  MarketCapitalization?: string;
  PERatio?: string;
  TrailingPE?: string;
  ForwardPE?: string;
  DividendYield?: string;
  '52WeekHigh'?: string;
  '52WeekLow'?: string;
  Currency?: string;
  Note?: string;
  Information?: string;
  'Error Message'?: string;
}

interface AvGlobalQuote {
  'Global Quote'?: Record<string, string>;
  Note?: string;
  Information?: string;
}

function avNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'None' || trimmed === '-' || trimmed === 'N/A') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function avText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'None') return null;
  return trimmed;
}

function isRateLimitMessage(payload: { Note?: string; Information?: string } | null | undefined): boolean {
  return !!payload && (typeof payload.Note === 'string' || typeof payload.Information === 'string');
}

export function normalizeAlphaVantage(
  ticker: string,
  overview: AvOverview | null,
  quote: AvGlobalQuote | null,
  retrievedAt: string
): ScanRow {
  const low = avNumber(overview?.['52WeekLow']);
  const high = avNumber(overview?.['52WeekHigh']);
  const pe = avNumber(overview?.TrailingPE ?? overview?.PERatio);
  const forwardPe = avNumber(overview?.ForwardPE);
  const yieldDecimal = avNumber(overview?.DividendYield);
  const rawPrice = avNumber(quote?.['Global Quote']?.['05. price']);
  const currentPrice = rawPrice != null && rawPrice > 0 ? rawPrice : null;

  return {
    ticker,
    companyName: avText(overview?.Name),
    source: 'alphavantage',
    industry: avText(overview?.Industry) ?? avText(overview?.Sector),
    // Alpha Vantage reports market cap in RAW units already (no x1e6).
    marketCap: avNumber(overview?.MarketCapitalization),
    currency: avText(overview?.Currency),
    week52Low: low,
    week52High: high,
    trailingPE: pe != null && pe > 0 ? pe : null,
    forwardPE: forwardPe != null && forwardPe > 0 ? forwardPe : null,
    // Decimal fraction -> percent. A real 0 (non-payer) is preserved.
    dividendYieldPercent: yieldDecimal == null ? null : yieldDecimal * 100,
    // Alpha Vantage OVERVIEW doesn't include YTD return.
    ytdReturn: null,
    // Alpha Vantage OVERVIEW doesn't supply these metrics.
    fcfYieldPercent: null,
    revenueGrowthTTM: null,
    debtToEquity: null,
    evToEbitda: null,
    interestCoverage: null,
    revenueGrowthQuarterly: null,
    operatingMarginTTM: null,
    operatingMargin5Y: null,
    currentPrice,
    rangePosition: computeRangePosition(currentPrice, low, high),
    retrievedAt
  };
}

function buildUrl(fn: string, ticker: string, apiKey: string): string {
  return `${BASE_URL}?function=${fn}&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
}

export function createAlphaVantageProvider(apiKey: string, retryOpts: RetryOptions = {}): QuoteProvider {
  const init: RequestInit = { headers: { Accept: 'application/json' } };

  return {
    name: 'alphavantage',
    async fetchCompany(ticker: string, signal?: AbortSignal): Promise<ScanRow> {
      const retrievedAt = new Date().toISOString();
      const reqInit = signal ? { ...init, signal } : init;

      // OVERVIEW is the required fundamentals call — one call returns everything
      // except current price. Fetch it first (and on its own, so it isn't
      // competing with the price call against the ~1 req/sec free-tier burst).
      let overviewRes: Response;
      try {
        overviewRes = await fetchWithRateLimitRetry(buildUrl('OVERVIEW', ticker, apiKey), reqInit, retryOpts);
      } catch {
        throw new ProviderError('PROVIDER_ERROR', `Network error while fetching "${ticker}" from Alpha Vantage.`);
      }
      if (overviewRes.status === 429) {
        throw new ProviderError('RATE_LIMITED', 'Alpha Vantage rate limit reached.');
      }
      if (!overviewRes.ok) {
        throw new ProviderError('PROVIDER_ERROR', `Alpha Vantage error for "${ticker}" (HTTP ${overviewRes.status}).`);
      }
      const overview = (await overviewRes.json()) as AvOverview;
      // Free-tier daily/burst limit arrives as a 200 with a Note/Information message.
      if (isRateLimitMessage(overview)) {
        throw new ProviderError('RATE_LIMITED', overview.Note ?? overview.Information ?? 'Alpha Vantage rate limit reached.');
      }
      if (overview['Error Message'] || (!overview.Name && !overview.Symbol)) {
        throw new ProviderError('NOT_FOUND', `No Alpha Vantage company data found for "${ticker}".`);
      }

      // GLOBAL_QUOTE (current price) is BEST-EFFORT. The free-tier ~1 req/sec
      // burst limit often throttles this second call even when OVERVIEW
      // succeeds, so never discard the fundamentals over it — just leave
      // price/range null when it doesn't come through.
      let quote: AvGlobalQuote | null = null;
      try {
        const quoteRes = await fetchWithRateLimitRetry(buildUrl('GLOBAL_QUOTE', ticker, apiKey), reqInit, retryOpts);
        if (quoteRes.ok) {
          const parsed = (await quoteRes.json()) as AvGlobalQuote;
          if (!isRateLimitMessage(parsed)) quote = parsed;
        }
      } catch {
        // ignore — current price is best-effort
      }

      return normalizeAlphaVantage(ticker, overview, quote, retrievedAt);
    }
  };
}
