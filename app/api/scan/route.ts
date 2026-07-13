import { NextResponse } from 'next/server';
import { parseTickers, DEFAULT_MAX_TICKERS } from '@/lib/tickers';
import { buildProvider, cacheTtlSeconds } from '@/lib/buildProvider';
import { scanTickers } from '@/lib/scan';
import { recordSnapshots } from '@/lib/snapshotStore';
import { getStore } from '@/lib/store';
import { clientKey, takeScanBudget, MAX_SCAN_BODY_BYTES } from '@/lib/requestGuard';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function noStore(init?: ResponseInit): ResponseInit {
  return { ...init, headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) } };
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SCAN_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body is too large.' }, noStore({ status: 413 }));
  }

  let body: ScanRequestBody;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SCAN_BODY_BYTES) throw new Error('body too large');
    const parsedBody: unknown = JSON.parse(raw);
    if (!isRecord(parsedBody)) throw new Error('body must be an object');
    const input = parsedBody.input;
    const tickers = parsedBody.tickers;
    const refresh = parsedBody.refresh;
    if (input !== undefined && typeof input !== 'string') throw new Error('input must be a string');
    if (typeof input === 'string' && input.length > 8_000) throw new Error('input is too long');
    if (tickers !== undefined && (!Array.isArray(tickers) || tickers.length > 100 || tickers.some((t) => typeof t !== 'string' || t.length > 32))) {
      throw new Error('tickers must be a bounded string array');
    }
    if (refresh !== undefined && typeof refresh !== 'boolean') throw new Error('refresh must be boolean');
    body = { input, tickers, refresh };
  } catch {
    return NextResponse.json({ error: 'Request body must be a bounded JSON object.' }, noStore({ status: 400 }));
  }

  const budget = await takeScanBudget(clientKey(request), body.refresh === true);
  if (!budget.allowed) {
    return NextResponse.json(
      { error: 'Scan request rate limit reached. Please retry later.' },
      noStore({ status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } })
    );
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
    return NextResponse.json(empty, noStore({ status: 200 }));
  }

  const provider = buildProvider();
  if (!provider) {
    return NextResponse.json(
      { error: 'Server is not configured: FINNHUB_API_KEY is missing. See README.md.' },
      noStore({ status: 500 })
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
    return NextResponse.json(response, noStore({ status: 200 }));
  } catch {
    // Total failure (e.g. provider unreachable) — generic message, no secrets.
    return NextResponse.json({ error: 'Failed to retrieve data from the provider.' }, noStore({ status: 502 }));
  }
}
