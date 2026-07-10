import type { ChangeSummary, MetricDelta } from '@/lib/seenRecords';

// Server-longitudinal "vs a stored snapshot" — the objective complement to the
// client "since you last viewed" panel (kept separate; they answer different
// questions). Static, server-rendered. Neutral facts, no color/verdict.
export default function SnapshotHistoryPanel({ change, ageDays }: { change: ChangeSummary; ageDays: number }) {
  const when = ageDays === 1 ? 'a stored snapshot 1 day ago' : `a stored snapshot ~${ageDays} days ago`;

  return (
    <section className="cs">
      <h2>Vs {when}</h2>
      {change.methodologyChanged && (
        <p className="hint">Scoring methodology changed since that snapshot — tier/score deltas are not comparable and are hidden.</p>
      )}
      {!change.anyChange ? (
        <p className="hint">No material change vs that snapshot.</p>
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
      <p className="hint">From stored daily snapshots (objective) — distinct from &ldquo;since you last viewed&rdquo; above. Informational.</p>
    </section>
  );
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`;
}
function metricText(d: MetricDelta): string {
  const from = d.from != null ? d.from.toFixed(1) : 'N/A';
  const to = d.to != null ? d.to.toFixed(1) : 'N/A';
  const move = d.delta != null ? ` (${d.delta > 0 ? '+' : ''}${d.delta.toFixed(1)}${d.unit === 'x' ? '×' : 'pp'})` : '';
  return `${from} → ${to}${move}`;
}
