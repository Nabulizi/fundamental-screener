import { formatMarketCap, formatCurrency, formatPe, formatPercent } from '@/lib/format';
import type { DataProvenance } from '@/lib/provenance';
import type { CrossCheck, CrossCheckField } from '@/lib/crossCheck';
import { PERIOD_LABEL, type MetricObservation, type QualityFlag } from '@/lib/observations';

const FLAG_TEXT: Record<QualityFlag, string> = {
  missing: 'not supplied by the source',
  implausible: 'outside sanity bounds — neutralized in scoring, verify at the source',
  'single-source': 'single source (no independent confirmation)',
  'secondary-disagrees': 'second source materially differs'
};

const SOURCE_LABEL: Record<'finnhub' | 'alphavantage', string> = {
  finnhub: 'Finnhub',
  alphavantage: 'Alpha Vantage (failover)',
};

function fmtValue(f: CrossCheckField, v: number | null, currency: string | null): string {
  switch (f.key) {
    case 'marketCap': return formatMarketCap(v, currency);
    case 'currentPrice': return formatCurrency(v, currency);
    case 'trailingPE': return formatPe(v);
    case 'dividendYieldPercent': return formatPercent(v);
  }
}

function crossCheckText(f: CrossCheckField, currency: string | null): string {
  if (f.status === 'unavailable') return 'not comparable (a source is missing it)';
  if (f.status === 'agree') return `agrees (within ${f.pctDiff != null ? (f.pctDiff * 100).toFixed(1) : '0'}%)`;
  return `differs — ${fmtValue(f, f.primary, currency)} vs ${fmtValue(f, f.secondary, currency)}${f.pctDiff != null ? ` (${(f.pctDiff * 100).toFixed(0)}%)` : ''}`;
}

// Static "Data & sources" block — provider, freshness, coverage, and a
// reported-vs-computed legend. No score, no color, no per-metric badges. The
// live "FCF base in use" is shown with the valuation UI, not here.
export default function DataSources({ model, crossCheck, currency, observations }: { model: DataProvenance; crossCheck: CrossCheck; currency: string | null; observations?: MetricObservation[] }) {
  const sourceText = model.source ? SOURCE_LABEL[model.source] : 'Unknown';
  // "Retrieved" is fetch time only — the underlying figures are TTM/annual/
  // estimate vintages whose effective dates the providers do not report.
  const freshness = `retrieved ${new Date(model.retrievedAt).toLocaleString()}${model.cached ? ' (served from cache)' : ''}`;
  const flagged = (observations ?? []).filter((o) => o.qualityFlags.some((f) => f !== 'single-source'));

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

      {observations && observations.length > 0 && (
        <div className="ds-observations">
          <dt>Field basis &amp; quality</dt>
          <dd>
            <ul className="ds-xcheck-list">
              {observations.map((o) => (
                <li key={o.key}>
                  <span className="ds-xcheck-label">{o.label}:</span>{' '}
                  {PERIOD_LABEL[o.period]} · {o.reportedOrComputed.replace('-', ' ')}
                  {o.qualityFlags.filter((f) => f !== 'single-source').map((f) => (
                    <span key={f} className="dq-flag"> · ⚑ {FLAG_TEXT[f]}</span>
                  ))}
                </li>
              ))}
            </ul>
            <span className="hint">
              &ldquo;Retrieved&rdquo; above is when this app fetched the data. The providers do not report
              effective/as-of dates (filing date, estimate vintage, quote time), so a recent fetch does
              not mean the underlying TTM/annual figures are current.
              {flagged.length === 0 ? '' : ` ${flagged.length} field${flagged.length === 1 ? '' : 's'} flagged above.`}
            </span>
          </dd>
        </div>
      )}

      <div className="ds-xcheck">
        <dt>Cross-check (Alpha Vantage)</dt>
        {!crossCheck.available ? (
          <dd className="hint">{crossCheck.reason}</dd>
        ) : (
          <dd>
            <ul className="ds-xcheck-list">
              {crossCheck.fields.map((f) => (
                <li key={f.key}><span className="ds-xcheck-label">{f.label}:</span> {crossCheckText(f, currency)}</li>
              ))}
            </ul>
            <span className="hint">A shallow second-source check on surface fields only — not the FCF, growth, or history the valuation uses.</span>
          </dd>
        )}
      </div>

      <p className="hint">
        As-reported (from the provider): revenue, operating cash flow, capex, shares, price, and the
        raw multiples. Computed by this tool (when the inputs are available): free cash flow
        (OCF − capex), margins, FCF / FCF yield, the market-implied growth, the scenarios, and the
        score — informational, not verdicts.
      </p>
    </section>
  );
}
