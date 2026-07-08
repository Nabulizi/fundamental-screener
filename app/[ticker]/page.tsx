import Link from 'next/link';
import { buildProvider, cacheTtlSeconds } from '@/lib/buildProvider';
import { scanTickers } from '@/lib/scan';
import { parseTickers } from '@/lib/tickers';
import { scoreRow, isFinancialIndustry, MAX_STRENGTH, MAX_RISK } from '@/lib/scoring';
import {
  formatMarketCap, formatCurrency, formatPercent, formatReturn, formatPe, formatRatio
} from '@/lib/format';
import DcfPanel from '@/components/DcfPanel';

// SERVER-ONLY: builds the provider from env keys, same path as /api/scan.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function TickerPage({ params }: { params: { ticker: string } }) {
  // Next.js App Router already URI-decodes dynamic segments; don't decode again.
  const raw = params.ticker.toUpperCase();
  const parsed = parseTickers(raw, 1);
  // A per-ticker route must be exactly ONE clean ticker — reject multi-token
  // paths like /AAPL,MSFT (which would otherwise silently load AAPL) or any
  // junk/duplicate tokens, rather than quietly resolving to the first match.
  const cleanSingle =
    parsed.valid.length === 1 && parsed.invalid.length === 0 && !parsed.limited && parsed.duplicatesRemoved === 0;
  const symbol = cleanSingle ? parsed.valid[0] : undefined;

  if (!symbol) return <Shell><p className="message">&ldquo;{raw}&rdquo; is not a valid ticker symbol.</p></Shell>;

  const provider = buildProvider();
  if (!provider) {
    return <Shell><p className="message">Server is not configured: FINNHUB_API_KEY is missing. See README.md.</p></Shell>;
  }

  // scan.ts swallows per-ticker provider errors, but cache/circuit-breaker bugs
  // could still throw — the app has no error boundary, so catch here (mirrors
  // the try/catch in app/api/scan/route.ts) rather than fall to Next's default.
  let rows, errors;
  try {
    ({ rows, errors } = await scanTickers([symbol], provider, { ttlSeconds: cacheTtlSeconds() }));
  } catch {
    return <Shell><p className="message">Couldn&rsquo;t load {symbol} — unexpected server error.</p></Shell>;
  }
  const row = rows[0];
  if (!row) {
    const err = errors[0];
    return <Shell><p className="message">Couldn&rsquo;t load {symbol}{err ? ` — ${err.message}` : '.'}</p></Shell>;
  }

  const scored = scoreRow(row);
  // Equity FCF yield is Price/FCF based (see types.ts), so absolute FCF ≈ marketCap × yield.
  const fcf0 =
    row.fcfYieldPercent != null && row.marketCap != null
      ? (row.marketCap * row.fcfYieldPercent) / 100
      : null;

  const metrics: [string, string][] = [
    ['Market cap', formatMarketCap(row.marketCap, row.currency)],
    ['Price', formatCurrency(row.currentPrice ?? null, row.currency)],
    ['YTD', formatReturn(row.ytdReturn)],
    ['P/E (TTM)', formatPe(row.trailingPE)],
    ['P/E (Fwd)', formatPe(row.forwardPE)],
    ['Div yield', formatPercent(row.dividendYieldPercent)],
    ['FCF yield', formatPercent(row.fcfYieldPercent)],
    ['Rev growth (TTM)', formatReturn(row.revenueGrowthTTM)],
    ['Debt / equity', formatRatio(row.debtToEquity)],
    ['EV / EBITDA', formatRatio(row.evToEbitda)]
  ];

  return (
    <Shell>
      <header className="detail-head">
        <div>
          <h1>{row.ticker}</h1>
          <p className="subtitle">{row.companyName ?? '—'}{row.industry ? ` · ${row.industry}` : ''}</p>
        </div>
        <div className={`tier tier-${scored.tier}`}>
          <span className="tier-name">{scored.tier}</span>
          <span className="tier-scores">
            Strength {scored.strengthScore}/{MAX_STRENGTH} · Risk {scored.riskScore}/{MAX_RISK}
          </span>
        </div>
      </header>

      <section className="metrics-grid">
        {metrics.map(([k, v]) => (
          <div key={k} className="metric">
            <span className="metric-label">{k}</span>
            <span className="metric-value">{v}</span>
          </div>
        ))}
      </section>

      <DcfPanel
        fcf0={fcf0}
        marketCap={row.marketCap}
        currency={row.currency}
        revenueGrowthTTM={row.revenueGrowthTTM}
        isFinancial={isFinancialIndustry(row.industry)}
      />

      <p className="meta">Informational only — not investment advice. Data retrieved {new Date(row.retrievedAt).toLocaleString()}.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="detail">
      <Link href="/" className="back-link">&larr; Screener</Link>
      {children}
    </main>
  );
}
