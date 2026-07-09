import Link from 'next/link';
import { buildProvider, buildValuationProvider, cacheTtlSeconds } from '@/lib/buildProvider';
import { scanTickers } from '@/lib/scan';
import { parseTickers } from '@/lib/tickers';
import { scoreRow, isBalanceSheetFinancial, hasInsufficientData, SCORING_VERSION, MAX_STRENGTH, MAX_RISK } from '@/lib/scoring';
import { buildDataProvenance } from '@/lib/provenance';
import type { SeenMetrics } from '@/lib/seenRecords';
import { getCachedValuation, setCachedValuation } from '@/lib/valuationCache';
import { computeDrivers, type ValuationProfile, type ValuationProvider } from '@/lib/valuation';
import {
  formatMarketCap, formatCurrency, formatPercent, formatReturn, formatPe, formatRatio
} from '@/lib/format';
import ValuationPanel from '@/components/ValuationPanel';
import DriverStrip from '@/components/DriverStrip';
import FundamentalsTable from '@/components/FundamentalsTable';
import PeerComparison from '@/components/PeerComparison';
import DataSources from '@/components/DataSources';
import ChangeSincePanel from '@/components/ChangeSincePanel';

async function loadValuation(ticker: string, provider: ValuationProvider, ttlSeconds: number): Promise<ValuationProfile> {
  const cached = getCachedValuation(ticker);
  if (cached) return cached;
  const profile = await provider.fetchValuationProfile(ticker);
  setCachedValuation(ticker, profile, ttlSeconds);
  return profile;
}

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

  const ttl = cacheTtlSeconds();
  const valuationProvider = buildValuationProvider();

  // Scorecard row (required) + valuation history (optional) in parallel.
  // allSettled so a failing/absent valuation fetch can NEVER take down the page:
  // the panel falls back to today's TTM-only behavior. scan.ts already swallows
  // per-ticker provider errors; this also catches cache/circuit-breaker throws
  // (the app has no error boundary).
  const [scanSettled, valSettled] = await Promise.allSettled([
    scanTickers([symbol], provider, { ttlSeconds: ttl }),
    valuationProvider ? loadValuation(symbol, valuationProvider, ttl) : Promise.resolve(null),
  ]);

  if (scanSettled.status === 'rejected') {
    return <Shell><p className="message">Couldn&rsquo;t load {symbol} — unexpected server error.</p></Shell>;
  }
  const { rows, errors } = scanSettled.value;
  const row = rows[0];
  if (!row) {
    const err = errors[0];
    return <Shell><p className="message">Couldn&rsquo;t load {symbol}{err ? ` — ${err.message}` : '.'}</p></Shell>;
  }
  const profile = valSettled.status === 'fulfilled' ? valSettled.value : null;
  const drivers = profile ? computeDrivers(profile) : null;
  const showDrivers = drivers != null && [
    drivers.revenueCagr, drivers.operatingMargin, drivers.fcfMargin,
    drivers.capexIntensity, drivers.sbcPctRevenue, drivers.shareCountChange
  ].some((v) => v != null);

  const scored = scoreRow(row);
  const isFinancial = isBalanceSheetFinancial(row.ticker, row.industry);
  // Equity FCF yield is Price/FCF based (see types.ts), so absolute FCF ≈ marketCap × yield.
  const fcf0 =
    row.fcfYieldPercent != null && row.marketCap != null
      ? (row.marketCap * row.fcfYieldPercent) / 100
      : null;

  // Single-basis metrics tracked for "since you last viewed" (implied growth is
  // excluded — it's base/assumption-dependent; see seenRecords).
  const seenCurrent: SeenMetrics = {
    scoringVersion: SCORING_VERSION,
    tier: scored.tier, strength: scored.strengthScore, risk: scored.riskScore,
    marketCap: row.marketCap, fcfYieldPercent: row.fcfYieldPercent,
    revenueGrowthTTM: row.revenueGrowthTTM, evToEbitda: row.evToEbitda,
  };

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

      <ChangeSincePanel ticker={row.ticker} current={seenCurrent} />

      {showDrivers && <DriverStrip drivers={drivers} />}

      {profile && profile.history.length > 0 && (
        <FundamentalsTable profile={profile} currency={row.currency} />
      )}

      <ValuationPanel
        ticker={row.ticker}
        retrievedAt={row.retrievedAt}
        fcf0={fcf0}
        marketCap={row.marketCap}
        currency={row.currency}
        revenueGrowthTTM={row.revenueGrowthTTM}
        isFinancial={isFinancial}
        profile={profile}
        sharesOutstanding={profile?.sharesOutstanding ?? null}
        drivers={drivers}
      />

      <PeerComparison selected={row} />

      <DataSources
        model={buildDataProvenance({
          source: row.source,
          cached: row.cached,
          retrievedAt: row.retrievedAt,
          profile,
          fcf0,
          isFinancial,
          insufficientData: hasInsufficientData(row),
        })}
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
