import { formatPercent, formatReturn } from '@/lib/format';
import type { MarketExpectations } from '@/lib/marketExpectations';
import Explain from '@/components/Explain';
import { impliedGrowthGloss } from '@/lib/explain/glosses';

// Neutral "what must be true?" card. No buy/sell, no target, no over/undervalued,
// no red/green. Deterministic display of the model built in lib/marketExpectations.
export default function MarketExpectationsCard({ model }: { model: MarketExpectations }) {
  // Match the reverse-DCF convention for clamped values: ">100%" / "<-50%".
  const growthText = (pct: number | null, outOfRange: boolean) => {
    if (pct == null) return 'N/A';
    return outOfRange ? `${pct > 0 ? '>' : '<'}${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
  };

  const bandText =
    model.bandLowPct != null && model.bandHighPct != null
      ? `~${model.bandLowPct.toFixed(0)}% – ${model.bandHighPct.toFixed(0)}%`
      : 'N/A';

  // formatReturn is signed for directional metrics; formatPercent for level ratios.
  const delivered: [string, string][] = [
    ['Trailing revenue growth', formatReturn(model.delivered.revenueGrowthTTM)],
    ['Revenue CAGR', formatReturn(model.delivered.revenueCagr)],
    ['FCF margin', formatPercent(model.delivered.fcfMargin)],
    ['Operating margin', formatPercent(model.delivered.operatingMargin)],
    ['Capex / revenue', formatPercent(model.delivered.capexIntensity)],
    ['Diluted shares Δ', formatReturn(model.delivered.shareCountChange)],
  ];

  return (
    <section className="mx">
      <h2>Market expectations</h2>

      <div className="mx-implied">
        <span className="dcf-label">Price implies (FCF growth, {model.discountRefPct.toFixed(0)}% cost of equity)</span>
        <span className="dcf-value">
          {growthText(model.impliedPct, model.impliedOutOfRange)}<span className="dcf-unit"> / yr</span>
        </span>
        <span className="hint">
          Across discount rates of {model.discountLowPct.toFixed(0)}–{model.discountHighPct.toFixed(0)}%, implied FCF
          growth ranges {bandText}
          {model.bandOutOfRange && ' (an endpoint is beyond the solvable range)'}.
        </span>
        <Explain gloss={impliedGrowthGloss(model.impliedPct, model.impliedOutOfRange, model.delivered.revenueGrowthTTM)} />
      </div>

      <div className="mx-delivered">
        <span className="dcf-label">Recently delivered</span>
        <div className="mx-grid">
          {delivered.map(([k, v]) => (
            <div key={k} className="mx-item">
              <span className="mx-item-label">{k}</span>
              <span className="mx-item-value">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="hint">
        To support this expectation, FCF growth would need to come from faster revenue growth, margin
        expansion, lower reinvestment (capex), lower SBC, or share-count discipline.
      </p>
      {model.gap && (
        <p className="scenario-note">
          Implied FCF growth is well above recent revenue growth — this requires substantial margin
          expansion, faster revenue growth, or lower reinvestment.
        </p>
      )}
      <p className="hint">Informational only — a comparison of implied vs delivered, not a valuation verdict.</p>
    </section>
  );
}
