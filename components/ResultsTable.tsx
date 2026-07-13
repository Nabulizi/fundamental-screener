'use client';

import { type ReactNode, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import type { ScanRow } from '@/lib/types';
import { type SortDir, type SortKey } from '@/lib/sort';
import { formatCurrency, formatMarketCap, formatPe, formatPercent, formatReturn, formatRatio, NA } from '@/lib/format';
import { rowFreshness, FRESHNESS_LABEL, type Freshness } from '@/lib/freshness';
import { clampFraction, computeRangePosition } from '@/lib/range';
import {
  scoreRow, criterionEvidence,
  type ScoredRow, type SignalTier,
  CRITERION_KEYS, CRITERION_LABELS, CRITERION_WEIGHT,
  MAX_STRENGTH, MAX_RISK, RISK_FLOOR, disqualificationCauses,
} from '@/lib/scoring';

// Freshness describes RETRIEVAL time only. The underlying fundamentals are
// TTM/annual/estimate vintages whose as-of dates the providers do not report,
// so none of these labels may claim the data itself is current.
const FRESHNESS_TITLE: Record<Freshness, string> = {
  fresh: 'Fetched from the provider in this scan',
  cached: 'Served from cache; the original retrieval time is shown',
  stale: 'Fetched more than 15 minutes ago — Refresh re-fetches from the provider'
};

// Period-basis tooltips for the metric columns (from the observation model):
// what window each figure describes, since fetch time is not data currency.
const PERIOD_TITLE: Partial<Record<SortKey, string>> = {
  marketCap: 'Point-in-time valuation at the provider’s last update',
  currentPrice: 'Latest provider quote (may be delayed)',
  ytdReturn: 'Year-to-date price return',
  week52High: 'Trailing 52-week price window',
  trailingPE: 'Trailing twelve months (TTM) earnings',
  forwardPE: 'Analyst consensus estimate — vintage not reported by the provider',
  dividendYieldPercent: 'Indicated annual dividend vs current price',
  fcfYieldPercent: 'TTM free cash flow, computed by this app from Price/FCF',
  revenueGrowthTTM: 'TTM year-over-year revenue growth',
  debtToEquity: 'Most recent reported quarter',
  evToEbitda: 'TTM EBITDA'
};

const TIER_LABEL: Record<SignalTier, string> = {
  strong: 'Higher alignment',
  moderate: 'Mixed signals',
  weak: 'Insufficient / flagged',
};

function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  return (
    <span className={`badge badge-${freshness}`} title={FRESHNESS_TITLE[freshness]}>
      {FRESHNESS_LABEL[freshness]}
    </span>
  );
}

// Stacked identity cell: ticker (primary) over company and industry (muted,
// truncated with a title tooltip). Replaces the former Ticker/Company/Industry
// columns so the table has a single clean left edge.
function IdentityCell({ row, freshness }: { row: ScanRow; freshness: Freshness }) {
  const company = row.companyName ?? NA;
  const industry = row.industry ?? NA;
  return (
    <div className="identity">
      <div className="identity-top">
        <Link href={`/${row.ticker}`} className="identity-ticker">{row.ticker}</Link>
        {/* Hide the badge for fresh rows so "FRESH" doesn't repeat down every
            row; only cached/stale rows get a badge. Legend above explains all. */}
        {freshness !== 'fresh' && <FreshnessBadge freshness={freshness} />}
        {/* Flag only the failover source (thinner data); Finnhub is the norm. */}
        {row.source === 'alphavantage' && (
          <span className="src-av" title="Alpha Vantage (failover) — thinner data (FCF N/A)">AV</span>
        )}
      </div>
      <div className="identity-company" title={company !== NA ? company : undefined}>
        {company === NA ? <span className="na">{NA}</span> : company}
      </div>
      <div className="identity-industry" title={industry !== NA ? industry : undefined}>
        {industry === NA ? <span className="na">{NA}</span> : industry}
      </div>
    </div>
  );
}

// 52-week range bar: $low ━━━●━━ $high with a dot marking the current price.
// Abbreviated prices (no cents for values ≥ $10). Accessible via aria-label.
function RangeBar({ row }: { row: ScanRow }) {
  const low = row.week52Low;
  const high = row.week52High;
  const price = row.currentPrice ?? null;

  if (low == null || high == null) {
    return <span className="na">{NA}</span>;
  }

  const position = computeRangePosition(price, low, high);
  const pct = position != null ? clampFraction(position) * 100 : null;

  const abbrev = (v: number) => v >= 10 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
  const ariaLabel = price != null
    ? `Current price ${abbrev(price)} in 52-week range ${abbrev(low)} to ${abbrev(high)}`
    : `52-week range ${abbrev(low)} to ${abbrev(high)}`;

  return (
    <div className="range-bar" aria-label={ariaLabel} title={ariaLabel}>
      <span className="range-low">{abbrev(low)}</span>
      <span className="range-track">
        {pct != null && <span className="range-dot" style={{ left: `${pct}%` }} />}
      </span>
      <span className="range-high">{abbrev(high)}</span>
    </div>
  );
}

interface Column {
  key: SortKey;
  label: string;
  numeric: boolean;
  sortable: boolean;
  // Proportional width (percent) for the fixed table layout. Every column
  // scales together so the gaps between them stay uniform at any screen width;
  // the four numeric columns share one width so their values line up evenly.
  width: string;
  truncate?: boolean;
  title?: string;
  center?: boolean;
  // Identity columns render a custom stacked cell (handled in the body loop)
  // instead of `render`, so `render` is optional for them.
  identity?: boolean;
  render?: (row: ScanRow) => ReactNode;
}

const COLUMNS: Column[] = [
  { key: 'ticker', label: 'Symbol', numeric: false, sortable: true, identity: true, width: '11%' },
  { key: 'strength', label: 'Strength', numeric: true, sortable: true, width: '5%', render: () => null /* handled specially */ },
  { key: 'risk', label: 'Risk', numeric: true, sortable: true, width: '5%', render: () => null /* handled specially */ },
  { key: 'coverage', label: 'Data', numeric: true, sortable: true, width: '6%', render: () => null /* handled specially */ },
  { key: 'marketCap', label: 'Mkt Cap', numeric: true, sortable: true, width: '8%', render: (r) => formatMarketCap(r.marketCap, r.currency) },
  { key: 'currentPrice', label: 'Price', numeric: true, sortable: false, width: '6%', render: (r) => formatCurrency(r.currentPrice ?? null, r.currency) },
  { key: 'ytdReturn', label: 'YTD', numeric: true, sortable: true, width: '6%', render: (r) => formatReturn(r.ytdReturn) },
  { key: 'week52High', label: '52W Range', numeric: false, sortable: false, center: true, width: '12%', render: (r) => <RangeBar row={r} /> },
  { key: 'trailingPE', label: 'P/E TTM', numeric: true, sortable: true, width: '6%', render: (r) => formatPe(r.trailingPE) },
  { key: 'forwardPE', label: 'P/E Fwd', numeric: true, sortable: true, width: '6%', render: (r) => formatPe(r.forwardPE) },
  { key: 'dividendYieldPercent', label: 'Div Yld', numeric: true, sortable: true, width: '6%', render: (r) => formatPercent(r.dividendYieldPercent) },
  { key: 'fcfYieldPercent', label: 'FCF Yld', numeric: true, sortable: true, width: '6%', render: (r) => formatPercent(r.fcfYieldPercent) },
  { key: 'revenueGrowthTTM', label: 'Rev Grw', numeric: true, sortable: true, width: '6%', render: (r) => formatReturn(r.revenueGrowthTTM) },
  { key: 'debtToEquity', label: 'D/E', numeric: true, sortable: true, width: '5%', render: (r) => formatRatio(r.debtToEquity) },
  { key: 'evToEbitda', label: 'EV/EBITDA', numeric: true, sortable: true, width: '6%', render: (r) => formatRatio(r.evToEbitda) }
];

function ariaSortValue(active: boolean, dir: SortDir): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
}

interface ResultsTableProps {
  rows: ScanRow[];
  lastUpdatedAt: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

export default function ResultsTable({ rows, lastUpdatedAt, sortKey, sortDir, onSort }: ResultsTableProps) {
  const updatedLabel = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : NA;
  const now = Date.now();

  // Track which rows have their score breakdown expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((ticker: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }, []);

  // Pre-compute scores for all rows
  const scoredMap = useMemo(() => {
    const map = new Map<string, ScoredRow>();
    for (const row of rows) {
      map.set(row.ticker, scoreRow(row));
    }
    return map;
  }, [rows]);

  // Signal-strength summary (neutral, non-advisory)
  const tierCounts = useMemo(() => {
    let strong = 0, moderate = 0, weak = 0;
    for (const sr of scoredMap.values()) {
      if (sr.tier === 'strong') strong++;
      else if (sr.tier === 'moderate') moderate++;
      else weak++;
    }
    return { strong, moderate, weak };
  }, [scoredMap]);

  return (
    <>
      <div className="table-head">
        <span className="table-summary" title="When this app last fetched from the provider — not when the underlying figures were reported">
          {rows.length} {rows.length === 1 ? 'company' : 'companies'} · Fetched {updatedLabel}
        </span>
        <div className="conviction-summary" title="Experimental heuristic tiers — informational only, not a recommendation">
          <span className="tier-badge tier-strong">{tierCounts.strong} {TIER_LABEL.strong}</span>
          <span className="tier-badge tier-moderate">{tierCounts.moderate} {TIER_LABEL.moderate}</span>
          <span className="tier-badge tier-weak">{tierCounts.weak} {TIER_LABEL.weak}</span>
        </div>
        <div className="freshness-legend" aria-hidden="true" title="Badges describe fetch time only — fundamentals are TTM/annual figures that update on filing cadence">
          <FreshnessBadge freshness="fresh" /> just fetched
          <FreshnessBadge freshness="cached" /> from cache
          <FreshnessBadge freshness="stale" /> fetched &gt; 15 min ago
        </div>
      </div>
      <div className="table-wrap" role="region" aria-label="Scan results" tabIndex={0}>
      <table>
        <caption className="sr-only">
          {rows.length} {rows.length === 1 ? 'company' : 'companies'}. Fetched from the provider: {updatedLabel}.
        </caption>
        <colgroup>
          {COLUMNS.map((col, idx) => (
            <col key={`${col.label}-${idx}`} style={{ width: col.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((col, idx) => {
              const active = col.sortable && col.key === sortKey;
              const arrow = (
                <span className={active ? 'arrow arrow-active' : 'arrow'} aria-hidden="true">
                  {active ? (sortDir === 'asc' ? '▲' : '▼') : '▼'}
                </span>
              );
              return (
                <th
                  key={`${col.label}-${idx}`}
                  scope="col"
                  className={col.numeric ? 'num' : undefined}
                  aria-sort={col.sortable ? ariaSortValue(active, sortDir) : undefined}
                >
                  {col.sortable ? (
                    <button type="button" className="sort-btn" onClick={() => onSort(col.key)} title={col.title ?? PERIOD_TITLE[col.key]}>
                      {col.label}
                      {arrow}
                    </button>
                  ) : (
                    <span title={col.title ?? PERIOD_TITLE[col.key]}>{col.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const freshness = rowFreshness(row, now);
            const scored = scoredMap.get(row.ticker);
            const tier: SignalTier = scored?.tier ?? 'weak';
            const isExpanded = expanded.has(row.ticker);
            // A benign Earnings-Quality −1 (growth drag) is waived, so it doesn't
            // count toward the disqualification reasons shown below.
            const causes = scored ? disqualificationCauses(scored.breakdown, row) : null;
            const eqDisqualifies = !!causes?.earningsQuality;
            const levDisqualifies = !!causes?.leverage;
            return (
              <>
              <tr key={row.ticker} className={`row-${tier}`}>
                {COLUMNS.map((col, idx) => {
                  if (col.identity) {
                    return (
                      <td key={`${row.ticker}-${idx}`} className="identity-cell">
                        <IdentityCell row={row} freshness={freshness} />
                      </td>
                    );
                  }
                  // Strength is the expandable evidence entry point. Risk and
                  // coverage remain separate visible metrics and sort values.
                  if (col.key === 'strength' && scored) {
                    return (
                      <td
                        key={`${row.ticker}-${idx}`}
                        className={`num score-cell score-${tier}${scored.flags.disqualified ? ' score-disqualified' : ''}`}
                        title={`Strength ${scored.strengthScore}/${MAX_STRENGTH} — click to ${isExpanded ? 'hide' : 'show'} evidence`}
                        onClick={() => toggleExpanded(row.ticker)}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        aria-controls={`${row.ticker}-breakdown`}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(row.ticker); } }}
                      >
                        <span className="score-value">{scored.strengthScore}</span>
                        <span className="score-max">/{MAX_STRENGTH}</span>
                        {(scored.flags.disqualified || scored.riskScore >= RISK_FLOOR) && (
                          <span className="score-flag" title={scored.flags.disqualified ? 'Hard floor: critical input rule' : `Elevated risk (${scored.riskScore}/${MAX_RISK})`}>⚠</span>
                        )}
                        {scored.flags.insufficientData && !scored.flags.disqualified && scored.riskScore < RISK_FLOOR && (
                          <span className="score-flag" title={`Insufficient data (${scored.coverage.covered}/${scored.coverage.applicable} criteria have data) — a missing value can never flag risk, so the tier is capped at Weak.`}>◌</span>
                        )}
                        {(scored.flags.valueTrap || scored.flags.peakCycle) && (
                          <span className="score-flag" title={scored.flags.valueTrap ? 'Possible value trap: optically cheap with shrinking revenue — capped at Moderate.' : 'Possible cycle peak: cheap on trailing numbers while estimates roll over — capped at Moderate.'}>▽</span>
                        )}
                        <span className={`score-chevron${isExpanded ? ' open' : ''}`} aria-hidden="true">▾</span>
                      </td>
                    );
                  }
                  if (col.key === 'risk' && scored) {
                    return <td key={`${row.ticker}-${idx}`} className="num" title={`Risk signals: ${scored.riskScore}/${MAX_RISK}`}>{scored.riskScore}/{MAX_RISK}</td>;
                  }
                  if (col.key === 'coverage' && scored) {
                    return <td key={`${row.ticker}-${idx}`} className="num" title={`${scored.coverage.covered} of ${scored.coverage.applicable} applicable criteria have data`}>{scored.coverage.covered}/{scored.coverage.applicable}</td>;
                  }
                  const value = col.render ? col.render(row) : null;
                  const cls = [col.numeric ? 'num' : '', col.truncate ? 'truncate' : ''].filter(Boolean).join(' ');
                  const titleAttr = col.truncate && typeof value === 'string' && value !== NA ? value : undefined;
                  return (
                    <td key={`${row.ticker}-${idx}`} className={cls || undefined} title={titleAttr}>
                      {value === NA ? <span className="na">{NA}</span> : value}
                    </td>
                  );
                })}
              </tr>
              {/* Expandable breakdown row */}
              {isExpanded && scored && (
                <tr id={`${row.ticker}-breakdown`} key={`${row.ticker}-breakdown`} className="breakdown-row">
                  <td colSpan={COLUMNS.length}>
                    <div className="breakdown-grid">
                      {CRITERION_KEYS.map((k) => {
                        const raw = scored.breakdown[k];
                        const w = CRITERION_WEIGHT[k];
                        const weighted = raw * w;
                        const cls = weighted > 0 ? 'bd-pos' : weighted < 0 ? 'bd-neg' : 'bd-zero';
                        return (
                          <div key={k} className={`breakdown-item ${cls}`}>
                            <div className="bd-head">
                              <span className="bd-label">{CRITERION_LABELS[k]}</span>
                              <span className="bd-weight">×{w}</span>
                              <span className="bd-value">{weighted > 0 ? `+${weighted}` : weighted}</span>
                            </div>
                            <div className="bd-evidence">{criterionEvidence(row, k)}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="breakdown-meta">
                      <span className="bd-strength">Strength {scored.strengthScore}/{MAX_STRENGTH}</span>
                      <span className="bd-risk">Risk {scored.riskScore}/{MAX_RISK}</span>
                      <span className="bd-coverage" title="Applicable criteria with data behind them. Deliberately-neutralized criteria (e.g. FCF reads for financials) are excluded.">Data {scored.coverage.covered}/{scored.coverage.applicable}</span>
                      {scored.flags.suspectRevenueGrowth && (
                        <span className="bd-flag" title="The provider's revenue-growth figure is implausible (beyond sanity bounds) — neutralized rather than scored. Verify at the source.">⚑ Revenue growth looks implausible (neutralized)</span>
                      )}
                      {scored.flags.insufficientData && (
                        <span className="bd-flag" title="Too few criteria have data to trust a tier — missing values can never flag risk, so sparse rows would otherwise look artificially safe.">◌ Insufficient data (tier capped at Weak)</span>
                      )}
                      {scored.flags.valueTrap && (
                        <span className="bd-flag" title="Optically cheap (low EV/EBITDA or high FCF yield) while revenue is shrinking — the cheapness likely prices the decline, not a mispricing. Capped at Moderate.">▽ Possible value trap (cheap + shrinking)</span>
                      )}
                      {scored.flags.peakCycle && (
                        <span className="bd-flag" title="Cyclical that looks cheap on trailing numbers while forward estimates roll over — the classic top-of-cycle signature. Capped at Moderate.">▽ Possible cycle peak (trailing cheap, estimates falling)</span>
                      )}
                      {scored.flags.serviceableLeverage && (
                        <span className="bd-flag" title="D/E is above 2, but interest coverage is strong (≥6×) — the debt is comfortably serviced. Costs Risk points but does not disqualify.">✓ Leverage is serviceable (risk, not disqualifying)</span>
                      )}
                      {scored.flags.softEarningsQuality && (
                        <span className="bd-flag" title="FCF/NI conversion is in the 0.5–0.7 band — earnings quality is questionable but not unambiguously broken (could be a working-capital swing or capex cycle). Costs Risk and caps the tier at Moderate.">▽ Soft earnings quality (capped at Moderate)</span>
                      )}
                      {scored.flags.cyclical && (
                        <span className="bd-flag" title="Cyclical industry — a low forward P/E here often reflects peak earnings, so P/E compression is neutralized.">↻ Cyclical (compression neutralized)</span>
                      )}
                      {scored.flags.crowding && (
                        <span className="bd-flag" title="Mega-cap trading near its 52-week high — already widely owned, capped at Moderate.">◆ Crowded (near 52W high)</span>
                      )}
                      {scored.flags.benignEarningsQuality && (
                        <span className="bd-flag" title="FCF trails earnings because revenue is surging (receivables build) and capex is heavy — a growth/capex drag, not a cash-conversion red flag. Scores −3 but does not disqualify.">↗ EQ −3 is a growth drag (not disqualifying)</span>
                      )}
                    </div>
                    {scored.flags.disqualified && (
                      <div className="breakdown-warning">
                        ⚠ Hard floor — critical rule in {eqDisqualifies ? 'Earnings Quality' : ''}{eqDisqualifies && levDisqualifies ? ' and ' : ''}{levDisqualifies ? 'Leverage' : ''}. This forces the research alignment label low regardless of Strength.
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
