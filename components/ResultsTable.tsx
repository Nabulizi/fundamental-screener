'use client';

import { type ReactNode } from 'react';
import type { ScanRow } from '@/lib/types';
import { type SortDir, type SortKey } from '@/lib/sort';
import { formatCurrency, formatMarketCap, formatPe, formatPercent, NA } from '@/lib/format';
import { rowFreshness, FRESHNESS_LABEL, type Freshness } from '@/lib/freshness';
import RangeBar from '@/components/RangeBar';

const FRESHNESS_TITLE: Record<Freshness, string> = {
  fresh: 'Fetched in this scan',
  cached: 'Served from cache; the original retrieval time is shown',
  stale: 'Older than 15 minutes — use Refresh for current data'
};

function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  return (
    <span className={`badge badge-${freshness}`} title={FRESHNESS_TITLE[freshness]}>
      {FRESHNESS_LABEL[freshness]}
    </span>
  );
}

interface Column {
  key: SortKey;
  label: string;
  numeric: boolean;
  sortable: boolean;
  truncate?: boolean;
  title?: string;
  render: (row: ScanRow) => ReactNode;
}

const COLUMNS: Column[] = [
  { key: 'ticker', label: 'Ticker', numeric: false, sortable: true, render: (r) => r.ticker },
  { key: 'companyName', label: 'Company', numeric: false, sortable: true, truncate: true, render: (r) => r.companyName ?? NA },
  { key: 'companyName', label: 'Industry', numeric: false, sortable: false, truncate: true, render: (r) => r.industry ?? NA },
  { key: 'marketCap', label: 'Market Cap', numeric: true, sortable: true, render: (r) => formatMarketCap(r.marketCap, r.currency) },
  { key: 'currentPrice', label: 'Price', numeric: true, sortable: true, render: (r) => formatCurrency(r.currentPrice ?? null, r.currency) },
  {
    key: 'week52High',
    label: '52-Week Range',
    numeric: false,
    sortable: true,
    title: 'Sort by 52-week high',
    render: (r) => <RangeBar position={r.rangePosition} low={r.week52Low} high={r.week52High} currency={r.currency} />
  },
  { key: 'trailingPE', label: 'P/E', numeric: true, sortable: true, render: (r) => formatPe(r.trailingPE) },
  { key: 'dividendYieldPercent', label: 'Dividend Yield', numeric: true, sortable: true, render: (r) => formatPercent(r.dividendYieldPercent) }
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

  return (
    <>
      <div className="freshness-legend" aria-hidden="true">
        <FreshnessBadge freshness="fresh" /> just fetched
        <FreshnessBadge freshness="cached" /> from cache
        <FreshnessBadge freshness="stale" /> &gt; 15 min old
      </div>
      <div className="table-wrap" role="region" aria-label="Scan results" tabIndex={0}>
      <table>
        <caption>
          {rows.length} {rows.length === 1 ? 'company' : 'companies'}. Data last updated: {updatedLabel}.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((col, idx) => {
              const active = col.sortable && col.key === sortKey;
              return (
                <th
                  key={`${col.label}-${idx}`}
                  scope="col"
                  className={col.numeric ? 'num' : undefined}
                  aria-sort={col.sortable ? ariaSortValue(active, sortDir) : undefined}
                >
                  {col.sortable ? (
                    <button type="button" className="sort-btn" onClick={() => onSort(col.key)} title={col.title}>
                      {col.label}
                      <span className="arrow" aria-hidden="true">
                        {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const freshness = rowFreshness(row, now);
            return (
              <tr key={row.ticker}>
                {COLUMNS.map((col, idx) => {
                  const value = col.render(row);
                  const isTicker = col.label === 'Ticker';
                  const cls = [col.numeric ? 'num' : '', col.truncate ? 'truncate' : ''].filter(Boolean).join(' ');
                  const titleAttr = col.truncate && typeof value === 'string' && value !== NA ? value : undefined;
                  return (
                    <td key={`${row.ticker}-${idx}`} className={cls || undefined} title={titleAttr}>
                      {value === NA ? <span className="na">{NA}</span> : value}
                      {isTicker && <FreshnessBadge freshness={freshness} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
