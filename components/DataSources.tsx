import type { DataProvenance } from '@/lib/provenance';

const SOURCE_LABEL: Record<'finnhub' | 'alphavantage', string> = {
  finnhub: 'Finnhub',
  alphavantage: 'Alpha Vantage (failover)',
};

// Static "Data & sources" block — provider, freshness, coverage, and a
// reported-vs-computed legend. No score, no color, no per-metric badges. The
// live "FCF base in use" is shown with the valuation UI, not here.
export default function DataSources({ model }: { model: DataProvenance }) {
  const sourceText = model.source ? SOURCE_LABEL[model.source] : 'Unknown';
  const freshness = model.cached
    ? `Cached, as of ${new Date(model.retrievedAt).toLocaleString()}`
    : `Fresh, retrieved ${new Date(model.retrievedAt).toLocaleString()}`;

  const coverage =
    model.historyYears === 0
      ? 'none'
      : `${model.historyYears} year${model.historyYears > 1 ? 's' : ''}`;

  return (
    <section className="ds">
      <h2>Data &amp; sources</h2>
      <dl className="ds-grid">
        <div>
          <dt>Price &amp; metrics</dt>
          <dd>{sourceText} · {freshness}</dd>
        </div>
        <div>
          <dt>Annual history</dt>
          <dd>
            {model.historySource ? 'financials-reported' : 'unavailable'} · {coverage}
            {model.fcfGated
              ? ' · FCF-based valuation gated (financial)'
              : model.availableBaseLabels.length > 0
                ? ` · FCF bases available: ${model.availableBaseLabels.join(', ')}`
                : ' · no positive FCF base'}
          </dd>
        </div>
      </dl>

      {model.insufficientData && (
        <p className="hint">Scorecard floored to Weak — insufficient data coverage for this ticker.</p>
      )}

      <p className="hint">
        As-reported (from the provider): revenue, operating cash flow, capex, shares, price, and the
        raw multiples. Computed by this tool: free cash flow (OCF − capex), margins, FCF yield, the
        market-implied growth, the scenarios, and the score — informational, not verdicts.
      </p>
    </section>
  );
}
