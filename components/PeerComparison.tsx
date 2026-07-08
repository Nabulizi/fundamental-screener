'use client';

import { useState } from 'react';
import type { ScanRow } from '@/lib/types';
import { parseTickers } from '@/lib/tickers';
import { useWatchlists } from '@/lib/useWatchlists';
import { buildPeerComparison, type PeerRow, type PeerCell } from '@/lib/peers';
import { formatMarketCap, formatPercent, formatReturn, formatRatio } from '@/lib/format';

const MAX_PEERS = 8;

interface Props {
  /** The company being compared, pinned as the first row (already fetched server-side). */
  selected: ScanRow;
}

// Lightweight, user-selected peer snapshot from screener metrics. Reuses the
// existing /api/scan path (partial-failure tolerant). No implied growth / history
// metrics in v1 (those need per-peer profiles). No ranking, no verdict colors.
export default function PeerComparison({ selected }: Props) {
  const { lists } = useWatchlists();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ peers: ScanRow[]; unavailable: string[] } | null>(null);

  async function compare() {
    const parsed = parseTickers(input, MAX_PEERS);
    const tickers = parsed.valid.filter((t) => t !== selected.ticker);
    if (tickers.length === 0) {
      setError('Enter up to 8 peer tickers to compare.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) throw new Error('scan failed');
      const body = (await res.json()) as { rows: ScanRow[] };
      const returned = new Set(body.rows.map((r) => r.ticker));
      const unavailable = tickers.filter((t) => !returned.has(t)); // failed / not found stay visible
      setData({ peers: body.rows, unavailable });
    } catch {
      setError('Couldn’t load peers. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const model = data ? buildPeerComparison(selected, data.peers, data.unavailable) : null;

  return (
    <section className="peers">
      <h2>Peers</h2>
      <p className="hint">
        Peer snapshot from screener metrics — a lightweight comparison against the peers <strong>you</strong>{' '}
        pick, not a full valuation comp and not an &ldquo;official&rdquo; peer set. Informational only.
      </p>

      <div className="peers-input">
        <input
          type="text"
          value={input}
          placeholder="Peer tickers, e.g. GM, F, TM, RIVN"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') compare(); }}
        />
        <button type="button" className="primary" onClick={compare} disabled={loading}>
          {loading ? 'Loading…' : 'Compare'}
        </button>
        {lists.length > 0 && (
          <select
            aria-label="Load peers from a saved watchlist"
            value=""
            onChange={(e) => { if (e.target.value) setInput(e.target.value); }}
          >
            <option value="">Load watchlist…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.tickers.join(', ')}>{l.name} ({l.tickers.length})</option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="dcf-warn">{error}</p>}

      {model && (
        <div className="peers-scroll">
          <table className="ft-table peers-table">
            <thead>
              <tr>
                <th>Company</th><th>Mkt cap</th><th>Rev growth</th><th>Op margin</th>
                <th>EV/EBITDA</th><th>FCF yield</th><th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r) => <Row key={r.ticker} row={r} />)}
              {model.medians && (
                <tr className="peers-median">
                  <th scope="row">Peer median (excl. this company, n={model.medians.n})</th>
                  <td>{formatMarketCap(model.medians.marketCap, selected.currency)}</td>
                  <td>{formatReturn(model.medians.revenueGrowthTTM)}</td>
                  <td>{formatPercent(model.medians.operatingMarginTTM)}</td>
                  <td>{formatRatio(model.medians.evToEbitda)}</td>
                  <td>{formatPercent(model.medians.fcfYield)}</td>
                  <td>—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ row }: { row: PeerRow }) {
  const label = (
    <th scope="row" className={row.selected ? 'peers-self' : undefined}>
      {row.ticker}{row.selected && ' (this company)'}
    </th>
  );
  if (row.unavailable || !row.cell) {
    return <tr>{label}<td colSpan={6} className="peers-na">unavailable</td></tr>;
  }
  const c: PeerCell = row.cell;
  return (
    <tr className={row.selected ? 'peers-self-row' : undefined}>
      {label}
      <td>{formatMarketCap(c.marketCap, null)}</td>
      <td>{formatReturn(c.revenueGrowthTTM)}</td>
      <td>{formatPercent(c.operatingMarginTTM)}</td>
      <td>{formatRatio(c.evToEbitda)}</td>
      <td>{c.fcfYieldNm ? 'n.m.' : formatPercent(c.fcfYield)}</td>
      {/* Neutral text — no verdict color in the peer table. */}
      <td className="peers-tier">{c.tier} {c.strength}/{c.risk}</td>
    </tr>
  );
}
