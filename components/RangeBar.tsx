'use client';

import { clampFraction } from '@/lib/range';
import { formatCurrency, NA } from '@/lib/format';

interface Props {
  position: number | null | undefined;
  low: number | null;
  high: number | null;
  currency: string | null;
}

// Compact, non-advisory 52-week range cell: a positional bar (when current
// price is available) plus the low–high endpoints underneath. It replaces the
// separate 52W Low / 52W High columns. Purely positional — not a buy/sell signal.
export default function RangeBar({ position, low, high, currency }: Props) {
  const hasRange = typeof low === 'number' && Number.isFinite(low) && typeof high === 'number' && Number.isFinite(high);
  const hasPos = position != null && Number.isFinite(position);

  if (!hasRange && !hasPos) {
    return <span className="na">{NA}</span>;
  }

  const pct = hasPos ? Math.round(clampFraction(position as number) * 100) : null;
  const ends = hasRange ? `${formatCurrency(low, currency)} – ${formatCurrency(high, currency)}` : NA;
  const label =
    pct != null
      ? `Current price at ${pct}% of the 52-week range (low ${formatCurrency(low, currency)}, high ${formatCurrency(high, currency)})`
      : `52-week range: low ${formatCurrency(low, currency)}, high ${formatCurrency(high, currency)}`;

  return (
    <div className="range-cell" role="img" aria-label={label}>
      <div className="range-bar">
        <span className="range-track">{pct != null && <span className="range-marker" style={{ left: `${pct}%` }} />}</span>
        <span className="range-pct" aria-hidden="true">
          {pct != null ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="range-ends" aria-hidden="true">
        {ends}
      </div>
    </div>
  );
}
