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
const asPct = (d: number) => Math.round(d * 100);

export default function ValuationPanel({
  fcf0, marketCap, currency, revenueGrowthTTM, isFinancial, profile, sharesOutstanding, drivers,
}: Props) {
  const [baseKey, setBaseKey] = useState<FcfBaseKey>(() => defaultFcfBaseKey(profile));
  const [customFcf, setCustomFcf] = useState<number | null>(null);
  // SHARED valuation assumptions (single source of truth) — so the market-
  // expectations card, reverse DCF, and scenario anchor never show conflicting
  // "market-implied growth" numbers. Percent / whole-year units.
  const [discountRate, setDiscountRate] = useState(asPct(SCENARIO_PRESETS.shared.costOfEquity));
  const [terminal, setTerminal] = useState(asPct(SCENARIO_PRESETS.shared.terminalGrowth));
  const [years, setYears] = useState(SCENARIO_PRESETS.shared.years);
  const shared = { costOfEquity: discountRate / 100, terminalGrowth: terminal / 100, years };
  const assumptionsValid = terminal <= discountRate - 1; // ≥100bps spread

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
          {/* Shared assumptions — ONE control set drives the card, reverse DCF,
              and scenario anchor, so they can never disagree. */}
          <div className="va-assumptions">
            <span className="dcf-label">Assumptions</span>
            <Slider label="Discount rate" value={discountRate} set={setDiscountRate} min={5} max={20} suffix="%" />
            <Slider label="Terminal growth" value={terminal} set={setTerminal} min={0} max={6} suffix="%" />
            <Slider label="Horizon" value={years} set={setYears} min={5} max={15} suffix="yr" />
          </div>
          {!assumptionsValid && (
            <p className="dcf-warn">Terminal growth must be at least 1% below the discount rate.</p>
          )}

          <MarketExpectationsCard
            model={buildMarketExpectations({
              effectiveFcf,
              marketCap,
              shared,
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
            discountRate={discountRate}
            terminal={terminal}
            years={years}
          />
          {/* key by the base so switching FCF base re-seeds the growths around
              the new anchor; changing shared assumptions moves the live anchor via
              props without wiping the user's growth edits. */}
          <ScenarioPanel
            key={effectiveFcf}
            effectiveFcf={effectiveFcf}
            marketCap={marketCap}
            currency={currency}
            shares={sharesOutstanding}
            costOfEquityPct={discountRate}
            terminalPct={terminal}
            years={years}
          />
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

function Slider({
  label, value, set, min, max, suffix
}: { label: string; value: number; set: (n: number) => void; min: number; max: number; suffix: string }) {
  return (
    <label className="dcf-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} />
      <output>{value}{suffix}</output>
    </label>
  );
}
