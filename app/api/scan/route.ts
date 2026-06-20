import { NextResponse } from 'next/server';
import { parseTickers, DEFAULT_MAX_TICKERS } from '@/lib/tickers';
import { createFinnhubProvider } from '@/lib/finnhub';
import { createAlphaVantageProvider } from '@/lib/alphavantage';
import { createFallbackProvider } from '@/lib/fallbackProvider';
import { scanTickers } from '@/lib/scan';
import type { QuoteProvider } from '@/lib/provider';
import type { ScanError, ScanResponse } from '@/lib/types';

// The Finnhub key is read here, server-side only. This module is never bundled
// into client code, so the secret cannot reach the browser.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScanRequestBody {
  input?: string;
  tickers?: string[];
  refresh?: boolean;
}

export async function POST(request: Request): Promise<NextResponse> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server is not configured: FINNHUB_API_KEY is missing. See README.md.' },
      { status: 500 }
    );
  }

  let body: ScanRequestBody;
  try {
    body = (await request.json()) as ScanRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const maxTickers = Number(process.env.MAX_TICKERS) || DEFAULT_MAX_TICKERS;
  const ttlSeconds = Number.isFinite(Number(process.env.CACHE_TTL_SECONDS))
    ? Number(process.env.CACHE_TTL_SECONDS)
    : 60;

  const rawInput = body.input ?? (Array.isArray(body.tickers) ? body.tickers.join(' ') : '');
  const parsed = parseTickers(rawInput, maxTickers);

  const invalidErrors: ScanError[] = parsed.invalid.map((ticker) => ({
    ticker,
    code: 'INVALID_TICKER',
    message: 'Not a valid ticker symbol.'
  }));

  const meta = {
    duplicatesRemoved: parsed.duplicatesRemoved,
    limited: parsed.limited,
    maxTickers
  };

  if (parsed.valid.length === 0) {
    const empty: ScanResponse = { rows: [], errors: invalidErrors, lastUpdatedAt: null, meta };
    return NextResponse.json(empty, { status: 200 });
  }

  // Finnhub is primary. If an Alpha Vantage key is configured, it becomes an
  // automatic failover (used per-ticker only when Finnhub rate-limits or errors).
  const providers: QuoteProvider[] = [createFinnhubProvider(apiKey)];
  const alphaVantageKey = process.env.ALPHAVANTAGE_API_KEY;
  if (alphaVantageKey) providers.push(createAlphaVantageProvider(alphaVantageKey));
  const provider = providers.length > 1 ? createFallbackProvider(providers) : providers[0];

  try {
    const result = await scanTickers(parsed.valid, provider, { ttlSeconds, refresh: body.refresh === true });
    const response: ScanResponse = {
      ...result,
      errors: [...invalidErrors, ...result.errors],
      meta
    };
    return NextResponse.json(response, { status: 200 });
  } catch {
    // Total failure (e.g. provider unreachable) — generic message, no secrets.
    return NextResponse.json({ error: 'Failed to retrieve data from the provider.' }, { status: 502 });
  }
}
