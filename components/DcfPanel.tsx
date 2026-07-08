'use client';

import { useState } from 'react';
import { impliedGrowth } from '@/lib/dcf';
import { formatMarketCap } from '@/lib/format';
import { fcfBaseOptions, defaultFcfBaseKey, type FcfBaseKey, type ValuationProfile } from '@/lib/valuation';

interface Props {
  /** TTM base free cash flow (raw currency units), or null when unavailable / non-positive. */
  fcf0: number | null;
  /** Current market cap in raw currency units (the equity value the market is pricing). */
  marketCap: number | null;
  currency: string | null;
  /** Trailing revenue growth (%), shown as neutral context for the implied number. */
  revenueGrowthTTM?: number | null;
  /** True for financial-sector tickers, where FCF is noise (see scorecard neutralization). */
  isFinancial?: boolean;
  /** Annual valuation history; null when unavailable — panel then behaves TTM-only. */
  profile?: ValuationProfile | null;
}

// Reverse DCF: rather than emit an intrinsic-value verdict (which reads as a
// price target), we surface the growth the market is *already pricing in* at
// today's price, given the user's discount/terminal/horizon assumptions.
//
// ponytail: fcf0 is equity/levered FCF (Price/FCF based), so the DCF value is an
// equity value compared directly to market cap; netCash stays 0 (see lib/dcf.ts).
export default function DcfPanel({ fcf0, marketCap, currency, revenueGrowthTTM, isFinancial, profile }: Props) {
  const [wacc, setWacc] = useState(11);
  const [terminal, setTerminal] = useState(3);
  const [years, setYears] = useState(10);
  const [baseKey, setBaseKey] = useState<FcfBaseKey>(() => defaultFcfBaseKey(profile ?? null));
  const [customFcf, setCustomFcf] = useState<number | null>(null);

  // Financials first: a broker/bank's "FCF" is dominated by customer-cash and
  // balance-sheet movements, not operating earnings — the same reason the
  // scorecard neutralizes FCF criteria for the sector. A DCF on it is noise.
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

  if (fcf0 == null || fcf0 <= 0) {
    return (
      <section className="dcf">
        <h2>What&rsquo;s priced in? (reverse DCF)</h2>
        <p className="hint">
          A reverse DCF needs positive free cash flow. This company&rsquo;s FCF is unavailable or
          negative, so it isn&rsquo;t meaningful here — informational only.
        </p>
      </section>
    );
  }

  // Base options honor the availability rules (TTM always; 3Y avg ≥2 usable
  // years; 5Y avg ≥3). With no usable history, options is [TTM] → the selector
  // is hidden and the panel behaves exactly like the TTM-only version.
  const options = fcfBaseOptions(profile ?? null, fcf0);
  const selectedOpt = options.find((o) => o.key === baseKey) ?? options[0];
  const effectiveFcf = customFcf ?? selectedOpt.value;
  const hasSelector = options.length > 1;

  const chooseBase = (k: FcfBaseKey) => { setBaseKey(k); setCustomFcf(null); };

  const usableFcf = effectiveFcf > 0 ? effectiveFcf : null;
  const valid = wacc / 100 > terminal / 100 && marketCap != null && usableFcf != null;
  const implied = valid
    ? impliedGrowth(
        { fcf0: usableFcf as number, discountRate: wacc / 100, terminalGrowth: terminal / 100, years },
        marketCap as number
      )
    : null;

  const pct = implied ? implied.growth * 100 : null;
  const impliedText =
    pct == null
      ? '—'
      : implied?.outOfRange
        // Keep the sign: the lower clamp is growth BELOW -50%, so show "<-50%".
        ? `${pct > 0 ? '>' : '<'}${pct.toFixed(0)}%`
        : `${pct.toFixed(1)}%`;

  const baseNote = selectedOpt.key === 'ttm'
    ? 'trailing-twelve-month FCF (a single lumpy year)'
    : `${selectedOpt.label} free cash flow`;

  return (
    <section className="dcf">
      <h2>What&rsquo;s priced in? (reverse DCF)</h2>
      <p className="hint">
        At today&rsquo;s market cap ({formatMarketCap(marketCap, currency)}) and a base of{' '}
        {baseNote} (~{formatMarketCap(effectiveFcf, currency)}), this is the annual FCF growth the
        market is implying over your horizon. Informational only — a market-implied assumption, not a target.
      </p>

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
            <input
              type="number"
              value={Math.round(effectiveFcf)}
              onChange={(e) => setCustomFcf(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <div className="dcf-inputs">
        <Slider label="Discount rate" value={wacc} set={setWacc} min={5} max={20} suffix="%" />
        <Slider label="Terminal growth" value={terminal} set={setTerminal} min={0} max={6} suffix="%" />
        <Slider label="Horizon" value={years} set={setYears} min={5} max={15} suffix="yr" />
      </div>

      {!valid ? (
        <p className="dcf-warn">
          {usableFcf == null ? 'Base FCF must be positive.' : 'Discount rate must exceed terminal growth.'}
        </p>
      ) : (
        <div className="dcf-out">
          <div>
            <span className="dcf-label">Market-implied FCF growth</span>
            <span className="dcf-value">{impliedText}<span className="dcf-unit"> / yr</span></span>
          </div>
          {revenueGrowthTTM != null && (
            <div>
              <span className="dcf-label">Trailing revenue growth</span>
              <span className="dcf-value">{revenueGrowthTTM.toFixed(1)}%<span className="dcf-unit"> / yr</span></span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Slider({
  label, value, set, min, max, suffix
}: { label: string; value: number; set: (n: number) => void; min: number; max: number; suffix: string }) {
  return (
    <label className="dcf-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} />
      <output>
        {value}
        {suffix}
      </output>
    </label>
  );
}
