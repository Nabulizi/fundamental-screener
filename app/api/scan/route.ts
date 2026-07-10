import { NextResponse } from 'next/server';
import { parseTickers, DEFAULT_MAX_TICKERS } from '@/lib/tickers';
import { buildProvider, cacheTtlSeconds } from '@/lib/buildProvider';
import { scanTickers } from '@/lib/scan';
import { recordSnapshots } from '@/lib/snapshotStore';
import { getStore } from '@/lib/store';
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
  let body: ScanRequestBody;
  try {
    body = (await request.json()) as ScanRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const maxTickers = Number(process.env.MAX_TICKERS) || DEFAULT_MAX_TICKERS;
  const ttlSeconds = cacheTtlSeconds();

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

  const provider = buildProvider();
  if (!provider) {
    return NextResponse.json(
      { error: 'Server is not configured: FINNHUB_API_KEY is missing. See README.md.' },
      { status: 500 }
    );
  }

  try {
    const result = await scanTickers(parsed.valid, provider, { ttlSeconds, refresh: body.refresh === true });
    // Longitudinal scan history (first fresh result per ticker per day).
    // recordSnapshots never throws; a snapshot failure never fails the scan.
    await recordSnapshots(result.rows, { store: getStore() });
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
