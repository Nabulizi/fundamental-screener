'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ResultsTable from '@/components/ResultsTable';
import FilterPanel from '@/components/FilterPanel';
import WatchlistManager from '@/components/WatchlistManager';
import { parseTickers, DEFAULT_MAX_TICKERS } from '@/lib/tickers';
import { applyFilters, EMPTY_FILTERS, type FilterCriteria } from '@/lib/filters';
import { runClientScan, type ScanProgress } from '@/lib/clientScan';
import { sortRows, type SortDir, type SortKey } from '@/lib/sort';
import { toCsv } from '@/lib/csv';
import { serializeShare, parseShare } from '@/lib/shareUrl';
import type { ScanError, ScanRow } from '@/lib/types';

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

export default function Page() {
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterCriteria>(EMPTY_FILTERS);
  const [progress, setProgress] = useState<ScanProgress>({ completed: 0, total: 0 });
  const [scannedTickers, setScannedTickers] = useState<string[]>([]);
  const [limited, setLimited] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('marketCap');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  const scanningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Restore tickers + filters from a shared URL on first load (no auto-scan).
  useEffect(() => {
    const { tickers, filters: restored } = parseShare(new URLSearchParams(window.location.search));
    if (tickers.length > 0) setInput(tickers.join(', '));
    setFilters(restored);
  }, []);

  const preview = useMemo(() => parseTickers(input, DEFAULT_MAX_TICKERS), [input]);
  const filteredRows = useMemo(
    () => (result ? applyFilters(result.rows, filters) : []),
    [result, filters]
  );
  // Displayed order = filtered then sorted; CSV export uses exactly this.
  const displayedRows = useMemo(
    () => sortRows(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir]
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
    const qs = serializeShare(tickers, filters);
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
    setFilters(EMPTY_FILTERS);
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
        <>
          <div className="results-toolbar">
            <button type="button" className="secondary" onClick={onRefresh} disabled={isLoading} title="Re-fetch fresh data, bypassing the cache">
              ↻ Refresh
            </button>
            <button type="button" className="secondary" onClick={downloadCsv} disabled={displayedRows.length === 0} title="Download the displayed rows as CSV">
              ⭳ Export CSV
            </button>
            <button type="button" className="secondary" onClick={copyShareUrl} title="Copy a link with these tickers and filters">
              🔗 Share
            </button>
          </div>
          {shareMsg && (
            <p className="meta" role="status" aria-live="polite">
              {shareMsg}
            </p>
          )}
          <FilterPanel
            rows={result.rows}
            matchCount={filteredRows.length}
            criteria={filters}
            onChange={setFilters}
            onReset={() => setFilters(EMPTY_FILTERS)}
          />
          {displayedRows.length > 0 ? (
            <ResultsTable
              rows={displayedRows}
              lastUpdatedAt={result.lastUpdatedAt}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
          ) : (
            <p className="message">No companies match the current filters. Adjust or reset the filters.</p>
          )}
        </>
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
        <p className="meta">Only the first {DEFAULT_MAX_TICKERS} tickers were scanned (MVP limit).</p>
      )}

      <p className="disclaimer">
        This tool displays publicly reported fundamentals for informational purposes only. It does not
        provide buy, sell, or hold recommendations, and unavailable data is shown as “N/A” — never as zero.
      </p>
    </main>
  );
}
