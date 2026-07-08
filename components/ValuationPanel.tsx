'use client';

import { useState } from 'react';
import { fcfBaseOptions, defaultFcfBaseKey, resolveFcfBase, type FcfBaseKey, type ValuationProfile, type Drivers } from '@/lib/valuation';
import { buildMarketExpectations } from '@/lib/marketExpectations';
import { SCENARIO_PRESETS } from '@/lib/dcf';
import { formatMarketCap } from '@/lib/format';
import DcfPanel from './DcfPanel';
import ScenarioPanel from './ScenarioPanel';
import MarketExpectationsCard from './MarketExpectationsCard';

interface Props {
  /** TTM base FCF (raw currency units), or null when unavailable / non-positive. */
  fcf0: number | null;
  marketCap: number | null;
  currency: string | null;
  revenueGrowthTTM?: number | null;
  /** Server-computed isBalanceSheetFinancial — kept OUT of the client bundle here. */
  isFinancial: boolean;
  profile: ValuationProfile | null;
  /** Latest annual diluted weighted-average shares, for per-share output. */
  sharesOutstanding: number | null;
  /** Driver metrics (delivered context for the market-expectations card). */
  drivers: Drivers | null;
}

// Owns the shared FCF-base selection so the reverse-DCF and scenario panels
// consume ONE effectiveFcf (no duplicated selector). The financial gate and the
// no-positive-base fallback live here — preserving Phase-2 behavior exactly.
export default function ValuationPanel({
  fcf0, marketCap, currency, revenueGrowthTTM, isFinancial, profile, sharesOutstanding, drivers,
}: Props) {
  const [baseKey, setBaseKey] = useState<FcfBaseKey>(() => defaultFcfBaseKey(profile));
  const [customFcf, setCustomFcf] = useState<number | null>(null);

  if (isFinancial) {
    return (
      <section className="dcf">
        <h2>What&rsquo;s priced in? (reverse DCF)</h2>
        <p className="hint">
          A cash-flow DCF isn&rsquo;t meaningful for financials — a bank or broker&rsquo;s cash flow is
          driven by customer balances and balance-sheet movements, not operating earnings (the same
          reason the scorecard neutralizes FCF criteria here). Informational only.
        </p>
      </section>
    );
  }

  const options = fcfBaseOptions(profile, fcf0);
  const resolved = resolveFcfBase(options, baseKey, customFcf);
  if (!resolved) {
    return (
      <section className="dcf">
        <h2>What&rsquo;s priced in? (reverse DCF)</h2>
        <p className="hint">
          A reverse DCF needs positive free cash flow. Neither trailing-twelve-month nor multi-year
          normalized FCF is positive here, so it isn&rsquo;t meaningful — informational only.
        </p>
      </section>
    );
  }

  const { option: selectedOpt, effectiveFcf } = resolved;
  const hasSelector = options.length > 1;
  const chooseBase = (k: FcfBaseKey) => { setBaseKey(k); setCustomFcf(null); };

  return (
    <>
      {hasSelector && (
        <div className="dcf-base">
          <span className="dcf-label">FCF base</span>
          <div className="dcf-base-btns">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                className={`dcf-base-btn${o.key === selectedOpt.key && customFcf == null ? ' active' : ''}`}
                onClick={() => chooseBase(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="dcf-adjust">
            adjust ($)
            <input type="number" value={Math.round(effectiveFcf)} onChange={(e) => setCustomFcf(Number(e.target.value))} />
            <span className="dcf-unit">≈ {formatMarketCap(effectiveFcf, currency)}</span>
          </label>
        </div>
      )}

      {effectiveFcf > 0 ? (
        <>
          <MarketExpectationsCard
            model={buildMarketExpectations({
              effectiveFcf,
              marketCap,
              shared: SCENARIO_PRESETS.shared,
              drivers,
              revenueGrowthTTM: revenueGrowthTTM ?? null,
            })}
          />
          <DcfPanel
            effectiveFcf={effectiveFcf}
            baseLabel={selectedOpt.label}
            marketCap={marketCap}
            currency={currency}
            revenueGrowthTTM={revenueGrowthTTM}
          />
          {/* key by the base so switching FCF base re-seeds the scenarios around
              the new market-implied anchor. */}
          <ScenarioPanel key={effectiveFcf} effectiveFcf={effectiveFcf} marketCap={marketCap} currency={currency} shares={sharesOutstanding} />
        </>
      ) : (
        <section className="dcf">
          <h2>What&rsquo;s priced in? (reverse DCF)</h2>
          <p className="dcf-warn">Base FCF must be positive.</p>
        </section>
      )}
    </>
  );
}
