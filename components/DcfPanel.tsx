'use client';

import { useState } from 'react';
import { impliedGrowth } from '@/lib/dcf';
import { formatMarketCap } from '@/lib/format';

interface Props {
  /** The selected FCF base (raw currency units), guaranteed positive by ValuationPanel. */
  effectiveFcf: number;
  /** Human label of the selected base (e.g. "TTM", "3Y avg (3 yr)") for the hint. */
  baseLabel: string;
  /** Current market cap in raw currency units (the equity value the market is pricing). */
  marketCap: number | null;
  currency: string | null;
  /** Trailing revenue growth (%), shown as neutral context for the implied number. */
  revenueGrowthTTM?: number | null;
}

// Reverse DCF: surface the FCF growth the market is *already pricing in* at
// today's price. The FCF-base selection lives in the parent ValuationPanel and
// is passed in as effectiveFcf, so this and the scenario panel share one base.
//
// ponytail: effectiveFcf is equity/levered FCF, so the DCF value is an equity
// value compared directly to market cap; netCash stays 0 (see lib/dcf.ts).
export default function DcfPanel({ effectiveFcf, baseLabel, marketCap, currency, revenueGrowthTTM }: Props) {
  const [wacc, setWacc] = useState(11);
  const [terminal, setTerminal] = useState(3);
  const [years, setYears] = useState(10);

  const valid = wacc / 100 > terminal / 100 && marketCap != null;
  const implied = valid
    ? impliedGrowth(
        { fcf0: effectiveFcf, discountRate: wacc / 100, terminalGrowth: terminal / 100, years },
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

  return (
    <section className="dcf">
      <h2>What&rsquo;s priced in? (reverse DCF)</h2>
      <p className="hint">
        At today&rsquo;s market cap ({formatMarketCap(marketCap, currency)}) and the {baseLabel} FCF
        base (~{formatMarketCap(effectiveFcf, currency)}), this is the annual FCF growth the market is
        implying over your horizon. Informational only — a market-implied assumption, not a target.
      </p>

      <div className="dcf-inputs">
        <Slider label="Discount rate" value={wacc} set={setWacc} min={5} max={20} suffix="%" />
        <Slider label="Terminal growth" value={terminal} set={setTerminal} min={0} max={6} suffix="%" />
        <Slider label="Horizon" value={years} set={setYears} min={5} max={15} suffix="yr" />
      </div>

      {!valid ? (
        <p className="dcf-warn">Discount rate must exceed terminal growth.</p>
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
