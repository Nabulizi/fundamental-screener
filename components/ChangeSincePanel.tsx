'use client';

import { useEffect, useState } from 'react';
import {
  STORAGE_KEY, parseStored, serialize, upsertSeen, findSeen, computeChangeSince,
  type SeenMetrics, type SeenRecord, type ChangeSummary, type MetricDelta,
} from '@/lib/seenRecords';

// "Since you last viewed" — reads the prior record for this ticker, computes
// neutral deltas, then writes the current view as the next baseline. Client-only
// (localStorage); renders nothing until the effect runs (no hydration mismatch).
export default function ChangeSincePanel({ ticker, current }: { ticker: string; current: SeenMetrics }) {
  const [state, setState] = useState<{ change: ChangeSummary; seenAt: string | null } | null>(null);

  useEffect(() => {
    let records: SeenRecord[] = [];
    try { records = parseStored(window.localStorage.getItem(STORAGE_KEY)); } catch { /* ignore */ }
    const prior = findSeen(records, ticker);
    setState({ change: computeChangeSince(prior, current), seenAt: prior?.seenAt ?? null });
    // This visit becomes the next baseline.
    const now: SeenRecord = { ...current, ticker: ticker.toUpperCase(), seenAt: new Date().toISOString() };
    try { window.localStorage.setItem(STORAGE_KEY, serialize(upsertSeen(records, now))); } catch { /* quota */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  if (!state) return null;
  const { change, seenAt } = state;

  if (change.firstView) {
    return (
      <section className="cs">
        <p className="hint">First time viewing this ticker — future visits will show what changed since now.</p>
      </section>
    );
  }

  const when = seenAt ? relative(seenAt) : 'your last view';

  return (
    <section className="cs">
      <h2>Since you last viewed ({when})</h2>
      {change.methodologyChanged && (
        <p className="hint">Scoring methodology changed since your last view — tier/score deltas are not comparable and are hidden.</p>
      )}
      {!change.anyChange ? (
        <p className="hint">No material change since your last view.</p>
      ) : (
        <ul className="cs-list">
          {change.tierChanged && (
            <li><span className="cs-label">Tier</span> <span className="cs-val">{change.tierFrom} → {change.tierTo}</span></li>
          )}
          {change.strengthDelta != null && change.strengthDelta !== 0 && (
            <li><span className="cs-label">Strength</span> <span className="cs-val">{signed(change.strengthDelta)}</span></li>
          )}
          {change.riskDelta != null && change.riskDelta !== 0 && (
            <li><span className="cs-label">Risk</span> <span className="cs-val">{signed(change.riskDelta)}</span></li>
          )}
          {change.metricDeltas.filter((d) => d.delta != null && d.delta !== 0).map((d) => (
            <li key={d.key}><span className="cs-label">{d.label}</span> <span className="cs-val">{metricText(d)}</span></li>
          ))}
        </ul>
      )}
      <p className="hint">Informational — a neutral record of what moved, not a signal.</p>
    </section>
  );
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}
function metricText(d: MetricDelta): string {
  const dec = d.unit === 'x' ? 1 : 1;
  const from = d.from != null ? d.from.toFixed(dec) : 'N/A';
  const to = d.to != null ? d.to.toFixed(dec) : 'N/A';
  const move = d.delta != null ? ` (${d.delta > 0 ? '+' : ''}${d.delta.toFixed(dec)}${d.unit === 'x' ? '×' : 'pp'})` : '';
  return `${from} → ${to}${move}`;
}
function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
