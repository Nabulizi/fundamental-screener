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
import { getScoringMethodology } from '@/lib/methodology';
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
const METHODOLOGY = getScoringMethodology();

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
  const [sortKey, setSortKey] = useState<SortKey>('strength');
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
    if (!result) return new Map<string, { strength: number; risk: number; coverage: number }>();
    const m = new Map<string, { strength: number; risk: number; coverage: number }>();
    for (const row of result.rows) {
      const scored = scoreRow(row);
      m.set(row.ticker, {
        strength: scored.strengthScore,
        risk: scored.riskScore,
        coverage: scored.coverage.fraction,
      });
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
      setSortDir(key === 'ticker' || key === 'companyName' || key === 'risk' ? 'asc' : 'desc');
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
      <h1>Fundamental Screener</h1>
      <p className="subtitle">
        Compare fundamentals across a watchlist. Enter tickers separated by commas, spaces, or new lines.
      </p>

      <p className="evidence-status" role="note">
        <strong>Experimental heuristic · methodology v{METHODOLOGY.version}</strong> — informational research aid,
        not a validated return forecast or investment recommendation.
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
        This tool displays publicly reported fundamentals for informational research only. It does not
        provide buy, sell, or hold recommendations, and unavailable data is shown as &quot;N/A&quot; — never as zero.
      </p>

      {/* Methodology accordion */}
      {result && result.rows.length > 0 && (
        <details className="methodology-section">
          <summary>How the research heuristic works ▾</summary>
          <div className="methodology-body">
            <p className="methodology-intro">
              This is <strong>{METHODOLOGY.status}</strong> (methodology v{METHODOLOGY.version}), not a
              rating or recommendation. Each stock is evaluated across <strong>{METHODOLOGY.criterionCount} criteria</strong>;
              every criterion produces a raw signal (+1 / 0 / −1) and is multiplied by its weight. Positive
              and negative signals stay separate: <strong>Strength (0–{METHODOLOGY.maxStrength})</strong> and
              <strong> Risk (0–{METHODOLOGY.maxRisk})</strong>. Missing data is shown as N/A and can floor the
              research tier rather than silently counting as favorable.
            </p>

            <h4>Benchmark Reference</h4>
            <p>What each criterion is measured against. The expandable per-row breakdown shows the
            actual figures (e.g. <em>FCF 7.00% vs EY 5.00%</em>) — compare them to these thresholds.</p>
            <table className="benchmark-table">
              <thead>
                <tr><th>Criterion</th><th className="bm-weight">Wt</th><th>Scores +1 when</th><th>Scores −1 when</th></tr>
              </thead>
              <tbody>
                {METHODOLOGY.criteria.map((criterion) => (
                  <tr key={criterion.key}>
                    <td>{criterion.label}</td>
                    <td className="bm-weight">×{criterion.weight}</td>
                    <td className="bm-pos">{criterion.benchmark.positive}</td>
                    <td className="bm-neg">{criterion.benchmark.negative}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h4>Weight Tiers</h4>
            <table className="weight-table">
              <thead><tr><th>Tier</th><th>Weight</th><th>Metrics</th><th>Rationale</th></tr></thead>
              <tbody>
                <tr><td>Survival &amp; Quality</td><td>×3</td><td>Earnings Quality, Leverage</td><td>Higher weight because these inputs describe material business risk; they are heuristics, not proof.</td></tr>
                <tr><td>Fundamental Strength</td><td>×2</td><td>Revenue Growth, Acceleration, FCF Yield, Margin Inflection, P/E Compression</td><td>Business and estimate context; not independently validated as predictive.</td></tr>
                <tr><td>Valuation, Timing &amp; Income</td><td>×1</td><td>EV/EBITDA, Div Coverage, 52W Position, YTD, Div Yield</td><td>Contextual signals with lower weight.</td></tr>
              </tbody>
            </table>

            <h4>Hard Floors</h4>
            <p>A stock is forced to <strong>Weak</strong> regardless of its Strength Score when a hard
            rule fires: insufficient coverage, Risk Score {METHODOLOGY.riskFloor}+, or a critical
            Earnings Quality/Leverage rule. The Strength Score describes positive signals; it does not
            override risk. (Exception: a <em>benign</em>
            Earnings-Quality −1 — see Adjustments — is waived from the floor.)</p>

            <h4>Adjustments</h4>
            <ul className="tier-list">
              <li><strong>Cyclicals (semis, autos):</strong> P/E compression is neutralized — a low forward P/E off peak earnings is a trap, not durable growth.</li>
              <li><strong>Leverage:</strong> D/E is neutralized for financials (leverage is structural) and when the ratio is buyback-distorted — negative or extremely high (&gt;10) book equity makes it noise; EV/EBITDA carries the real read.</li>
              <li><strong>Crowding:</strong> a mega-cap ($200B+) trading near its 52-week high is capped at Moderate — already widely owned.</li>
              <li><strong>Benign earnings quality:</strong> a −1 Earnings Quality (FCF below earnings yield) does <em>not</em> disqualify when FCF is still solidly positive (≥2%) and revenue is surging (&gt;20%) — that&apos;s a growth/capex drag (receivables build + heavy capex), not a cash-conversion red flag. It still costs Risk points.</li>
            </ul>

            <h4>Signal Tiers</h4>
            <ul className="tier-list">
              {METHODOLOGY.tierRules.map((rule) => (
                <li key={rule.label}><span className={`tier-dot tier-${rule.label.toLowerCase()}`} /> <strong>{rule.label}:</strong> {rule.rule}</li>
              ))}
            </ul>

            <h4>The {METHODOLOGY.criterionCount} scoring reads (ordered by significance)</h4>
            <ol className="reads-list">
              {METHODOLOGY.criteria.map((criterion) => (
                <li key={criterion.key}><strong>{criterion.label}</strong> <em className="tier-tag">×{criterion.weight}</em> —
                  scores +1 / 0 / −1 using the benchmark shown above. This is a mechanical heuristic;
                  it is not a fraud, distress, or return forecast.</li>
              ))}
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
              <li><strong>Sector context:</strong> Thresholds are broad-market. Cyclicals and financials get targeted
                adjustments (above), but most thresholds are not fully sector-relative — a 2.5 D/E may be normal for
                utilities but alarming for tech.</li>
              <li><strong>Qualitative factors:</strong> Management quality, competitive moats, regulatory risk, and
                macroeconomic shifts are invisible to any purely quantitative screen.</li>
              <li><strong>Data staleness:</strong> Metrics are trailing (TTM) or most-recent-quarter; forward estimates
                rely on analyst consensus that can change rapidly.</li>
              <li><strong>Missing data:</strong> An unavailable metric is neutral for that criterion, but low
                overall coverage or missing risk-critical inputs floors the research tier. Coverage is still
                not proof that the remaining inputs are correct.</li>
            </ul>
          </div>
        </details>
      )}
    </main>
  );
}
