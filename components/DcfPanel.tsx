'use client';

import { useState } from 'react';
import { impliedGrowth } from '@/lib/dcf';
import { formatMarketCap } from '@/lib/format';

interface Props {
  /** Base free cash flow in raw currency units, or null when unavailable / non-positive. */
  fcf0: number | null;
  /** Current market cap in raw currency units (the equity value the market is pricing). */
  marketCap: number | null;
  currency: string | null;
  /** Trailing revenue growth (%), shown as neutral context for the implied number. */
  revenueGrowthTTM?: number | null;
}

// Reverse DCF: rather than emit an intrinsic-value verdict (which reads as a
// price target), we surface the growth the market is *already pricing in* at
// today's price, given the user's discount/terminal/horizon assumptions. The
// user supplies the judgment ("do I believe more or less than that?").
//
// ponytail: fcf0 is equity/levered FCF (Price/FCF based), so the DCF value is an
// equity value compared directly to market cap; netCash stays 0 (see lib/dcf.ts).
export default function DcfPanel({ fcf0, marketCap, currency, revenueGrowthTTM }: Props) {
  const [wacc, setWacc] = useState(11);
  const [terminal, setTerminal] = useState(3);
  const [years, setYears] = useState(10);

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

  const valid = wacc / 100 > terminal / 100 && marketCap != null;
  const implied = valid
    ? impliedGrowth(
        { fcf0, discountRate: wacc / 100, terminalGrowth: terminal / 100, years },
        marketCap as number
      )
    : null;

  const pct = implied ? implied.growth * 100 : null;
  const impliedText =
    pct == null
      ? '—'
      : implied?.outOfRange
        ? `${pct > 0 ? '>' : '<'}${Math.abs(pct).toFixed(0)}%`
        : `${pct.toFixed(1)}%`;

  return (
    <section className="dcf">
      <h2>What&rsquo;s priced in? (reverse DCF)</h2>
      <p className="hint">
        At today&rsquo;s market cap ({formatMarketCap(marketCap, currency)}) and trailing-twelve-month
        FCF (~{formatMarketCap(fcf0, currency)}, a single lumpy year), this is the annual FCF growth
        the market is implying over your horizon. Informational only — a market-implied assumption,
        not a target.
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
