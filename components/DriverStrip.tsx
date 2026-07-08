import { formatPercent, formatReturn } from '@/lib/format';
import type { Drivers } from '@/lib/valuation';

// Neutral trailing-fundamentals strip. No colors, verdicts, or recommendation
// language — just the numbers, each degrading to N/A on its own. Context for the
// reverse-DCF (does the implied growth look achievable?), the user judges.
export default function DriverStrip({ drivers }: { drivers: Drivers }) {
  const win = drivers.windowYears ? ` (~${drivers.windowYears}y)` : '';
  // formatReturn is signed (+/−) for the directional metrics; formatPercent for ratios.
  const items: [string, string][] = [
    [`Revenue CAGR${win}`, formatReturn(drivers.revenueCagr)],
    ['Operating margin', formatPercent(drivers.operatingMargin)],
    ['FCF margin', formatPercent(drivers.fcfMargin)],
    ['Capex / revenue', formatPercent(drivers.capexIntensity)],
    ['SBC / revenue', formatPercent(drivers.sbcPctRevenue)],
    [`Diluted shares Δ${win}`, formatReturn(drivers.shareCountChange)],
  ];

  return (
    <section className="drivers">
      <h2>Drivers</h2>
      <div className="drivers-grid">
        {items.map(([label, value]) => (
          <div key={label} className="driver">
            <span className="driver-label">{label}</span>
            <span className="driver-value">{value}</span>
          </div>
        ))}
      </div>
      <p className="hint">
        Trailing fundamentals from reported annual history. Diluted-share change is a raw delta —
        it combines issuance, buybacks, SBC, splits, and M&amp;A, not buybacks alone. Informational only.
      </p>
    </section>
  );
}
