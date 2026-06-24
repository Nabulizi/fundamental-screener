'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ResultsTable from '@/components/ResultsTable';
import WatchlistManager from '@/components/WatchlistManager';
import { parseTickers, DEFAULT_MAX_TICKERS } from '@/lib/tickers';

const MAX_TICKERS = Number(process.env.NEXT_PUBLIC_MAX_TICKERS) || DEFAULT_MAX_TICKERS;
// Filtering UI was removed; EMPTY_FILTERS is still passed to share-URL encoding
// so links keep round-tripping (and old links with filter params still parse).
import { EMPTY_FILTERS } from '@/lib/filters';
import { runClientScan, type ScanProgress } from '@/lib/clientScan';
import { sortRows, type SortDir, type SortKey } from '@/lib/sort';
import { scoreRow } from '@/lib/scoring';
import { toCsv } from '@/lib/csv';
import { serializeShare, parseShare } from '@/lib/shareUrl';
import type { ScanError, ScanRow } from '@/lib/types';
import type { FearGreedData } from '@/lib/fearGreed';

type Phase = 'idle' | 'loading' | 'done' | 'error';

interface ScanResult {
  rows: ScanRow[];
  errors: ScanError[];
  lastUpdatedAt: string | null;
}

const EXAMPLE = 'AAPL, MSFT, KO, JPM, XOM';

function newestTimestamp(rows: ScanRow[]): string | null {
  if (rows.length === 0) return null;
  return rows.map((r) => r.retrievedAt).sort().at(-1) ?? null;
}

// Monochrome line icons (currentColor) so the toolbar reads as one consistent
// set rather than a mix of mismatched emoji glyphs.
const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const;

function IconRefresh() {
  return (
    <svg className="btn-icon" {...iconProps}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg className="btn-icon" {...iconProps}>
      <path d="M12 3v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg className="btn-icon" {...iconProps}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

export default function Page() {
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress>({ completed: 0, total: 0 });
  const [scannedTickers, setScannedTickers] = useState<string[]>([]);
  const [limited, setLimited] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('marketCap');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);

  const scanningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch market sentiment on mount (non-blocking).
  useEffect(() => {
    fetch('/api/feargreed')
      .then((r) => r.json())
      .then((d: FearGreedData | null) => { if (d && typeof d.score === 'number') setFearGreed(d); })
      .catch(() => {});
  }, []);

  // Restore tickers from a shared URL on first load (no auto-scan). Any filter
  // params in an older link are ignored — the filtering UI no longer exists.
  useEffect(() => {
    const { tickers } = parseShare(new URLSearchParams(window.location.search));
    if (tickers.length > 0) setInput(tickers.join(', '));
  }, []);

  const preview = useMemo(() => parseTickers(input, MAX_TICKERS), [input]);
  // Displayed order = sorted result rows; CSV export uses exactly this.
  const scoreMap = useMemo(() => {
    if (!result) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const row of result.rows) {
      m.set(row.ticker, scoreRow(row).score);
    }
    return m;
  }, [result]);

  const displayedRows = useMemo(
    () => (result ? sortRows(result.rows, sortKey, sortDir, scoreMap) : []),
    [result, sortKey, sortDir, scoreMap]
  );

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'ticker' || key === 'companyName' ? 'asc' : 'desc');
    }
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(displayedRows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-scan-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyShareUrl() {
    const tickers = scannedTickers.length > 0 ? scannedTickers : preview.valid;
    const qs = serializeShare(tickers, EMPTY_FILTERS);
    const url = `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg('Shareable link copied to clipboard.');
    } catch {
      setShareMsg(url);
    }
    window.setTimeout(() => setShareMsg(null), 4000);
  }

  async function runScan(tickers: string[], refresh: boolean, invalid: string[]) {
    if (scanningRef.current) return; // ignore repeated clicks while a scan is in flight
    if (tickers.length === 0) return;

    scanningRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setErrorMsg(null);
    setProgress({ completed: 0, total: tickers.length });
    setScannedTickers(tickers);

    const invalidErrors: ScanError[] = invalid.map((ticker) => ({
      ticker,
      code: 'INVALID_TICKER',
      message: 'Not a valid ticker symbol.'
    }));

    try {
      const { rows, errors } = await runClientScan(tickers, {
        refresh,
        signal: controller.signal,
        onProgress: setProgress
      });
      if (controller.signal.aborted) return;
      setResult({ rows, errors: [...invalidErrors, ...errors], lastUpdatedAt: newestTimestamp(rows) });
      setPhase('done');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setErrorMsg('Could not complete the scan. Please try again.');
      setPhase('error');
    } finally {
      scanningRef.current = false;
    }
  }

  function onScan(event: React.FormEvent) {
    event.preventDefault();
    setLimited(preview.limited);
    void runScan(preview.valid, false, preview.invalid);
  }

  function onRefresh() {
    if (scannedTickers.length === 0) return;
    void runScan(scannedTickers, true, []);
  }

  function onClear() {
    abortRef.current?.abort();
    scanningRef.current = false;
    setInput('');
    setResult(null);
    setErrorMsg(null);
    setPhase('idle');
    setProgress({ completed: 0, total: 0 });
    setScannedTickers([]);
    setLimited(false);
  }

  function removeTickerChip(ticker: string) {
    setInput(preview.valid.filter((t) => t !== ticker).join(', '));
  }

  const hasRows = !!result && result.rows.length > 0;
  const hasErrors = !!result && result.errors.length > 0;
  const rateLimited = !!result && result.errors.some((e) => e.code === 'RATE_LIMITED');
  const isLoading = phase === 'loading';

  return (
    <main>
      <h1>Stock Scanner</h1>
      <p className="subtitle">
        Compare fundamentals across a watchlist. Enter tickers separated by commas, spaces, or new lines.
      </p>

      {fearGreed && (
        <div className={`fear-greed-badge fg-${fearGreed.label.toLowerCase().replace(' ', '-')}`} title="CNN Fear & Greed Index — market sentiment gauge">
          <span className="fg-label">Market Sentiment</span>
          <span className="fg-score">{fearGreed.score}</span>
          <span className="fg-desc">{fearGreed.label}</span>
        </div>
      )}

      <form className="form" onSubmit={onScan}>
        <label htmlFor="tickers">Tickers</label>
        <textarea
          id="tickers"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={EXAMPLE}
          aria-describedby="tickers-hint"
        />

        {preview.valid.length > 0 && (
          <ul className="ticker-chips" aria-label="Tickers to scan">
            {preview.valid.map((t) => (
              <li key={t}>
                {t}
                <button type="button" className="chip-clear" aria-label={`Remove ${t}`} onClick={() => removeTickerChip(t)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <p id="tickers-hint" className="hint">
          {preview.valid.length > 0
            ? `${preview.valid.length} ticker${preview.valid.length === 1 ? '' : 's'} ready`
            : `Example: ${EXAMPLE}`}
          {preview.duplicatesRemoved > 0 ? ` · ${preview.duplicatesRemoved} duplicate(s) removed` : ''}
          {preview.invalid.length > 0 ? ` · ignoring invalid: ${preview.invalid.join(', ')}` : ''}
        </p>

        <div className="actions">
          <button type="submit" className="primary" disabled={isLoading || preview.valid.length === 0}>
            {isLoading ? `Scanning ${progress.completed} of ${progress.total}…` : 'Scan'}
          </button>
          <button type="button" className="secondary" onClick={onClear} disabled={isLoading}>
            Clear
          </button>
        </div>
      </form>

      <WatchlistManager currentTickers={preview.valid} onLoad={(tickers) => setInput(tickers.join(', '))} />

      <div className="status" aria-live="polite" role="status">
        {isLoading && (
          <p className="message">
            <span className="spinner" aria-hidden="true" />
            Scanning {progress.completed} of {progress.total}…
          </p>
        )}

        {phase === 'error' && <p className="message error">{errorMsg ?? 'Something went wrong.'}</p>}

        {phase === 'done' && !hasRows && !hasErrors && (
          <p className="message">No results. Try a ticker such as AAPL.</p>
        )}

        {phase === 'done' && !hasRows && hasErrors && (
          <p className="message error">None of the submitted tickers returned data. See details below.</p>
        )}

        {rateLimited && (
          <p className="message error">
            The data provider rate limit was reached for some tickers. Wait a moment and refresh.
          </p>
        )}
      </div>

      {hasRows && result && (
        <div className="results-area">
          <div className="results-toolbar">
            <button type="button" className="secondary" onClick={onRefresh} disabled={isLoading} title="Re-fetch fresh data, bypassing the cache">
              <IconRefresh /> Refresh
            </button>
            <button type="button" className="secondary" onClick={downloadCsv} disabled={displayedRows.length === 0} title="Download the displayed rows as CSV">
              <IconDownload /> Export CSV
            </button>
            <button type="button" className="secondary" onClick={copyShareUrl} title="Copy a link with these tickers">
              <IconShare /> Share
            </button>
          </div>
          {shareMsg && (
            <p className="meta" role="status" aria-live="polite">
              {shareMsg}
            </p>
          )}
          {/* Data quality banner */}
          {result.errors.length > 0 && (
            <div className="data-quality-banner">
              <span className="dq-stat">{result.rows.length}/{result.rows.length + result.errors.length} tickers loaded</span>
              {(() => {
                const nullFields = result.rows.reduce((count, r) => {
                  let n = 0;
                  if (r.marketCap == null) n++;
                  if (r.trailingPE == null) n++;
                  if (r.forwardPE == null) n++;
                  if (r.dividendYieldPercent == null) n++;
                  if (r.currentPrice == null) n++;
                  return count + n;
                }, 0);
                const totalFields = result.rows.length * 5;
                const coverage = totalFields > 0 ? Math.round(((totalFields - nullFields) / totalFields) * 100) : 100;
                return coverage < 100 ? <span className="dq-stat">{coverage}% field coverage</span> : null;
              })()}
            </div>
          )}
          <ResultsTable
            rows={displayedRows}
            lastUpdatedAt={result.lastUpdatedAt}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
        </div>
      )}

      {hasErrors && result && (
        <div className="message error" style={{ marginTop: '1rem' }}>
          <strong>Some tickers could not be loaded:</strong>
          <ul className="errors-list">
            {result.errors.map((err) => (
              <li key={`${err.ticker}-${err.code}`}>
                <strong>{err.ticker}</strong> — {err.message} <code>{err.code}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {limited && (
        <p className="meta">Only the first {MAX_TICKERS} tickers were scanned (MVP limit).</p>
      )}

      <p className="disclaimer">
        This tool displays publicly reported fundamentals for informational purposes only. It does not
        provide buy, sell, or hold recommendations, and unavailable data is shown as &quot;N/A&quot; — never as zero.
      </p>

      {/* Methodology accordion */}
      {result && result.rows.length > 0 && (
        <details className="methodology-section">
          <summary>How Scoring Works ▾</summary>
          <div className="methodology-body">
            <p className="methodology-intro">
              Each stock is evaluated across <strong>10 criteria</strong> drawn from an elite analyst&apos;s
              composite scoring framework. Every criterion produces a raw signal (+1 / 0 / −1), then
              is multiplied by its tier weight. Max score: <strong>+17</strong>. Min: <strong>−16</strong>.
            </p>

            <h4>Weight Tiers</h4>
            <table className="weight-table">
              <thead><tr><th>Tier</th><th>Weight</th><th>Metrics</th><th>Rationale</th></tr></thead>
              <tbody>
                <tr><td>Survival &amp; Quality</td><td>×3</td><td>Earnings Quality, Leverage</td><td>A −3 here can mean permanent loss. These are eliminators.</td></tr>
                <tr><td>Fundamental Strength</td><td>×2</td><td>Revenue Growth, FCF Yield, P/E Compression</td><td>Core business quality — strongly predictive but recoverable if one is weak.</td></tr>
                <tr><td>Valuation, Timing &amp; Income</td><td>×1</td><td>EV/EBITDA, Div Coverage, 52W Pos, YTD, Div Yield</td><td>Useful context, not convictions on their own.</td></tr>
              </tbody>
            </table>

            <h4>Hard Floor Rule</h4>
            <p>Any stock scoring −1 on Earnings Quality or Leverage (weighted to −3) is <strong>automatically
            disqualified</strong> — forced to &quot;Pass&quot; regardless of total score. The score ranks what&apos;s good;
            the floor rule eliminates what&apos;s dangerous.</p>

            <h4>Conviction Tiers</h4>
            <ul className="tier-list">
              <li><span className="tier-dot tier-high" /> <strong>High Conviction (12+ / 17):</strong> multiple bullish signals aligned across all tiers</li>
              <li><span className="tier-dot tier-watchlist" /> <strong>Watchlist (7–11 / 17):</strong> promising but needs one more catalyst</li>
              <li><span className="tier-dot tier-pass" /> <strong>Pass (&lt;7 or disqualified):</strong> insufficient evidence or critical red flag</li>
            </ul>

            <h4>The 10 Scoring Reads (ordered by significance)</h4>
            <ol className="reads-list">
              <li><strong>Earnings Quality</strong> <em className="tier-tag">×3</em> — Compares FCF Yield to Earnings Yield (100÷P/E). When FCF exceeds
                earnings yield, cash flows confirm reported earnings. Your fraud filter.
                <em>+3 if FCF Yield &gt; EY by 1pp+, −3 if below.</em></li>
              <li><strong>Leverage (D/E)</strong> <em className="tier-tag">×3</em> — Permanent capital loss prevention. A great business with fatal
                debt goes to zero. <em>+3 if &lt;1.0, −3 if &gt;2.0.</em></li>
              <li><strong>Revenue Growth</strong> <em className="tier-tag">×2</em> — The foundation of all forward estimates. Declining revenue makes
                every other bullish signal suspect. <em>+2 if &gt;10%, −2 if negative.</em></li>
              <li><strong>FCF Yield Level</strong> <em className="tier-tag">×2</em> — Core value signal. Once you know earnings are real,
                FCF yield tells you if the price is fair. <em>+2 if &gt;5%, −2 if &lt;2%.</em></li>
              <li><strong>P/E Compression</strong> <em className="tier-tag">×2</em> — Analyst expectations, grounded by the fundamentals above.
                <em>+2 if FWD &lt; TTM, −2 if FWD &gt; TTM.</em></li>
              <li><strong>Valuation (EV/EBITDA)</strong> <em className="tier-tag">×1</em> — Leverage-adjusted cross-check on FCF and P/E.
                <em>+1 if &lt;15, −1 if &gt;25.</em></li>
              <li><strong>Dividend Coverage</strong> <em className="tier-tag">×1</em> — More fundamental than price position — a broken dividend
                destroys the investment thesis. <em>+1 if FCF covers dividend, −1 if not. Non-payers: 0.</em></li>
              <li><strong>52-Week Position</strong> <em className="tier-tag">×1</em> — Entry timing. Technical, not fundamental — belongs after all
                business quality reads. <em>+1 if &lt;40%, −1 if &gt;90%.</em></li>
              <li><strong>YTD Momentum</strong> <em className="tier-tag">×1</em> — Weakest fundamental signal. Useful confirmation, not a driver.
                <em>+1 if positive, −1 if negative.</em></li>
              <li><strong>Dividend Yield</strong> <em className="tier-tag">×1</em> — Income enhancement only. The least predictive of the 10.
                <em>+1 if &gt;1.5%. Non-payers: 0. Never negative.</em></li>
            </ol>
          </div>
        </details>
      )}

      {/* Blind spots disclaimer */}
      {result && result.rows.length > 0 && (
        <details className="blind-spots-section">
          <summary>What This Score Cannot Tell You ▾</summary>
          <div className="blind-spots-body">
            <ul>
              <li><strong>Sector context:</strong> Thresholds are broad-market, not sector-adjusted. A 2.5 D/E may be
                normal for utilities but alarming for tech.</li>
              <li><strong>Qualitative factors:</strong> Management quality, competitive moats, regulatory risk, and
                macroeconomic shifts are invisible to any purely quantitative screen.</li>
              <li><strong>Data staleness:</strong> Metrics are trailing (TTM) or most-recent-quarter; forward estimates
                rely on analyst consensus that can change rapidly.</li>
              <li><strong>Missing data:</strong> If a metric is unavailable (N/A), that criterion scores 0 rather than
                penalizing or rewarding — this can inflate scores for thinly-covered stocks.</li>
            </ul>
          </div>
        </details>
      )}
    </main>
  );
}
