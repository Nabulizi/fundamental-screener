'use client';

import { useState } from 'react';
import { fcfBaseOptions, defaultFcfBaseKey, resolveFcfBase, type FcfBaseKey, type ValuationProfile, type Drivers } from '@/lib/valuation';
import { buildMarketExpectations } from '@/lib/marketExpectations';
import { SCENARIO_PRESETS, marketImpliedGrowthPct, seedScenarioGrowths, type ScenarioLabel } from '@/lib/dcf';
import { formatMarketCap } from '@/lib/format';
import type { CaseInputs, ResolvedLoad } from '@/lib/valuationCases';
import DcfPanel from './DcfPanel';
import ScenarioPanel from './ScenarioPanel';
import MarketExpectationsCard from './MarketExpectationsCard';
import ValuationCases from './ValuationCases';

interface Props {
  ticker: string;
  retrievedAt: string;
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

const asPct = (d: number) => Math.round(d * 100);

// Single owner of the whole valuation "case": FCF base, custom FCF, shared
// assumptions, AND the scenario growths — so a saved case is one snapshot and
// loading it just sets state. Financial gate + no-positive-base fallback here.
export default function ValuationPanel({
  ticker, retrievedAt, fcf0, marketCap, currency, revenueGrowthTTM, isFinancial, profile, sharesOutstanding, drivers,
}: Props) {
  const [baseKey, setBaseKey] = useState<FcfBaseKey>(() => defaultFcfBaseKey(profile));
  const [customFcf, setCustomFcf] = useState<number | null>(null);
  const [discountRate, setDiscountRate] = useState(asPct(SCENARIO_PRESETS.shared.costOfEquity));
  const [terminal, setTerminal] = useState(asPct(SCENARIO_PRESETS.shared.terminalGrowth));
  const [years, setYears] = useState(SCENARIO_PRESETS.shared.years);
  const [growths, setGrowths] = useState(() => {
    const opts = fcfBaseOptions(profile, fcf0);
    const dflt = opts.find((o) => o.key === defaultFcfBaseKey(profile)) ?? opts[0];
    const initFcf = dflt?.value ?? fcf0 ?? 0;
    return seedScenarioGrowths(marketImpliedGrowthPct(initFcf, marketCap, SCENARIO_PRESETS.shared).pct);
  });
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);

  const setGrowth = (k: ScenarioLabel, v: number) => setGrowths((g) => ({ ...g, [k]: v }));

  const applyCase = (r: ResolvedLoad) => {
    setLoadWarnings(r.warnings);
    if (r.inputs) {
      setBaseKey(r.inputs.baseKey);
      setCustomFcf(r.inputs.customFcf);
      setDiscountRate(r.inputs.discountRate);
      setTerminal(r.inputs.terminalGrowth);
      setYears(r.inputs.horizon);
      setGrowths(r.inputs.growths);
    }
  };

  const options = fcfBaseOptions(profile, fcf0);
  const resolved = isFinancial ? null : resolveFcfBase(options, baseKey, customFcf);
  const effectiveFcf = resolved?.effectiveFcf ?? null;
  const selectedOpt = resolved?.option ?? null;
  const shared = { costOfEquity: discountRate / 100, terminalGrowth: terminal / 100, years };
  const assumptionsValid = terminal <= discountRate - 1; // ≥100bps spread
  const valuationActive = resolved != null && (effectiveFcf ?? 0) > 0;

  const expectations = valuationActive
    ? buildMarketExpectations({ effectiveFcf: effectiveFcf!, marketCap, shared, drivers, revenueGrowthTTM: revenueGrowthTTM ?? null })
    : null;

  const currentInputs: CaseInputs | null = valuationActive
    // Save the base actually IN USE (selectedOpt), not the stale baseKey state —
    // resolveFcfBase may have fallen back to the first option.
    ? { baseKey: selectedOpt?.key ?? baseKey, customFcf, discountRate, terminalGrowth: terminal, horizon: years, growths }
    : null;
  const snapshot = valuationActive
    ? { effectiveFcf, impliedFcfGrowthPct: expectations?.impliedPct ?? null, inputs: currentInputs }
    : null;

  const chooseBase = (k: FcfBaseKey) => { setBaseKey(k); setCustomFcf(null); };
  const resetToImplied = () => {
    if (valuationActive) setGrowths(seedScenarioGrowths(marketImpliedGrowthPct(effectiveFcf!, marketCap, shared).pct));
  };

  return (
    <>
      <ValuationCases
        ticker={ticker}
        retrievedAt={retrievedAt}
        currentInputs={currentInputs}
        snapshot={snapshot}
        availableBaseKeys={options.map((o) => o.key)}
        fallbackBaseKey={options[0]?.key ?? defaultFcfBaseKey(profile)}
        onApply={applyCase}
      />
      {loadWarnings.map((w, i) => <p key={i} className="hint va-warn">{w}</p>)}

      {isFinancial ? (
        <section className="dcf">
          <h2>What&rsquo;s priced in? (reverse DCF)</h2>
          <p className="hint">
            A cash-flow DCF isn&rsquo;t meaningful for financials — a bank or broker&rsquo;s cash flow is
            driven by customer balances and balance-sheet movements, not operating earnings (the same
            reason the scorecard neutralizes FCF criteria here). Informational only.
          </p>
        </section>
      ) : !resolved ? (
        <section className="dcf">
          <h2>What&rsquo;s priced in? (reverse DCF)</h2>
          <p className="hint">
            A reverse DCF needs positive free cash flow. Neither trailing-twelve-month nor multi-year
            normalized FCF is positive here, so it isn&rsquo;t meaningful — informational only.
          </p>
        </section>
      ) : (
        <>
          {options.length > 1 && (
            <div className="dcf-base">
              <span className="dcf-label">FCF base</span>
              <div className="dcf-base-btns">
                {options.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    className={`dcf-base-btn${o.key === selectedOpt?.key && customFcf == null ? ' active' : ''}`}
                    onClick={() => chooseBase(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <label className="dcf-adjust">
                adjust ($)
                <input type="number" value={Math.round(effectiveFcf ?? 0)} onChange={(e) => setCustomFcf(Number(e.target.value))} />
                <span className="dcf-unit">≈ {formatMarketCap(effectiveFcf, currency)}</span>
              </label>
            </div>
          )}

          {valuationActive ? (
            <>
              <div className="va-assumptions">
                <span className="dcf-label">Assumptions</span>
                <Slider label="Discount rate" value={discountRate} set={setDiscountRate} min={5} max={20} suffix="%" />
                <Slider label="Terminal growth" value={terminal} set={setTerminal} min={0} max={6} suffix="%" />
                <Slider label="Horizon" value={years} set={setYears} min={5} max={15} suffix="yr" />
              </div>
              {!assumptionsValid && (
                <p className="dcf-warn">Terminal growth must be at least 1% below the discount rate.</p>
              )}

              <p className="hint">
                DCF inputs — FCF base in use: <strong>{selectedOpt!.label}</strong>{' '}
                (~{formatMarketCap(effectiveFcf, currency)}); history:{' '}
                {profile?.source ? `reported, ${profile.history.length}y` : 'unavailable (TTM only)'}.
              </p>

              <MarketExpectationsCard model={expectations!} />
              <DcfPanel
                effectiveFcf={effectiveFcf!}
                baseLabel={selectedOpt!.label}
                marketCap={marketCap}
                currency={currency}
                revenueGrowthTTM={revenueGrowthTTM}
                discountRate={discountRate}
                terminal={terminal}
                years={years}
              />
              <div className="va-reset">
                <button type="button" className="secondary" onClick={resetToImplied}>Reset scenarios to implied growth</button>
              </div>
              <ScenarioPanel
                effectiveFcf={effectiveFcf!}
                marketCap={marketCap}
                currency={currency}
                shares={sharesOutstanding}
                costOfEquityPct={discountRate}
                terminalPct={terminal}
                years={years}
                growths={growths}
                onGrowth={setGrowth}
              />
            </>
          ) : (
            <section className="dcf">
              <h2>What&rsquo;s priced in? (reverse DCF)</h2>
              <p className="dcf-warn">Base FCF must be positive.</p>
            </section>
          )}
        </>
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
