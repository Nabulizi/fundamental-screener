'use client';

import { impliedGrowth } from '@/lib/dcf';
import { formatMarketCap } from '@/lib/format';
import Explain from '@/components/Explain';
import { reverseDcfGloss } from '@/lib/explain/glosses';

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
  /** SHARED assumptions (percent / whole years) owned by ValuationPanel — so this
   *  and the market-expectations card always show the same implied growth. */
  discountRate: number;
  terminal: number;
  years: number;
}

// Reverse DCF: the FCF growth the market is *already pricing in*. Assumptions and
// the FCF base are owned by ValuationPanel and passed in, so the card, this panel,
// and the scenario anchor share one basis.
//
// Note: effectiveFcf is equity/levered FCF, so the DCF value is an equity value
// compared directly to market cap; netCash stays 0 (see lib/dcf.ts).
export default function DcfPanel({
  effectiveFcf, baseLabel, marketCap, currency, revenueGrowthTTM, discountRate, terminal, years,
}: Props) {
  const valid = discountRate / 100 > terminal / 100 && marketCap != null;
  const implied = valid
    ? impliedGrowth(
        { fcf0: effectiveFcf, discountRate: discountRate / 100, terminalGrowth: terminal / 100, years },
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
        implying at the assumptions above. Informational only — a market-implied assumption, not a target.
      </p>
      <Explain gloss={reverseDcfGloss()} />

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
