'use client';

import {
  computeScenarios, isInvertedRange, scenarioInputsValid, marketImpliedGrowthPct,
  intrinsicDcf, terminalContribution, sensitivityGrid,
  type ScenarioLabel,
} from '@/lib/dcf';
import { formatCurrency, formatMarketCap } from '@/lib/format';
import Explain from '@/components/Explain';
import { scenarioGloss } from '@/lib/explain/glosses';

interface Props {
  /** The selected FCF base (raw currency units), guaranteed positive by ValuationPanel. */
  effectiveFcf: number;
  /** Market cap — the reference the implied-growth anchor is solved against. */
  marketCap: number | null;
  currency: string | null;
  /** Latest annual diluted weighted-average shares, or null when unavailable. */
  shares: number | null;
  /** SHARED assumptions (percent / whole years) owned by ValuationPanel. */
  costOfEquityPct: number;
  terminalPct: number;
  years: number;
  /** Per-scenario FCF growths — OWNED by ValuationPanel (so a saved case owns the
   *  whole state); this panel is a readout/editor. */
  growths: { bear: number; base: number; bull: number };
  onGrowth: (k: ScenarioLabel, v: number) => void;
}

const LABELS: Record<ScenarioLabel, string> = { bear: 'Bear', base: 'Base', bull: 'Bull' };

// Assumption-driven value-per-share RANGE, anchored to the reverse-DCF
// market-implied FCF growth. No upside/downside, current-price comparison, or
// green/red verdicts. Growths are owned by the parent (single case owner).
export default function ScenarioPanel({
  effectiveFcf, marketCap, currency, shares, costOfEquityPct, terminalPct, years, growths, onGrowth,
}: Props) {
  const coe = costOfEquityPct;
  const terminal = terminalPct;
  const setGrowth = onGrowth;

  // Live anchor uses the SCENARIO's own shared assumptions (not reverse-DCF state).
  const anchor = marketImpliedGrowthPct(effectiveFcf, marketCap, {
    costOfEquity: coe / 100, terminalGrowth: terminal / 100, years,
  });

  const valid = scenarioInputsValid(growths, coe, terminal, years);
  const hasShares = shares != null && shares > 0;

  const results = valid
    ? computeScenarios(
        effectiveFcf,
        { bear: growths.bear / 100, base: growths.base / 100, bull: growths.bull / 100 },
        { costOfEquity: coe / 100, terminalGrowth: terminal / 100, years },
        shares
      )
    : null;
  const inverted = results ? isInvertedRange(results) : false;

  const cellValue = (equityValue: number, perShare: number | null) =>
    hasShares && perShare != null ? formatCurrency(perShare, currency) : formatMarketCap(equityValue, currency);

  return (
    <section className="scenario">
      <h2>Scenario range around market-implied FCF growth</h2>
      <p className="hint">
        {hasShares ? 'Value per share' : 'Equity value'} if <strong>FCF growth</strong> comes in below
        (Bear), near (Base), or above (Bull) what today&rsquo;s price implies. Base is initialized at the
        market-implied growth; all editable. Not a fair value, target, or recommendation — informational only.
      </p>
      <Explain gloss={scenarioGloss()} />

      {anchor.pct != null && (
        <p className="scenario-note">
          Market-implied FCF growth at these shared assumptions:{' '}
          <strong>{anchor.outOfRange ? '>100' : anchor.pct.toFixed(1)}%/yr</strong>
          {anchor.outOfRange && ' — above the editable scenario range; Base is capped at 100%.'}
        </p>
      )}

      <div className="scenario-cols">
        {(['bear', 'base', 'bull'] as ScenarioLabel[]).map((label) => {
          const r = results?.find((x) => x.label === label);
          return (
            <div key={label} className="scenario-col">
              <span className="scenario-name">{LABELS[label]}</span>
              <label className="scenario-growth">
                FCF growth
                <span>
                  <input type="number" value={growths[label]} min={-20} max={100}
                    onChange={(e) => setGrowth(label, Number(e.target.value))} />%/yr
                </span>
              </label>
              <span className="scenario-value">{r ? cellValue(r.equityValue, r.perShare) : '—'}</span>
            </div>
          );
        })}
      </div>

      {!valid ? (
        <p className="dcf-warn">
          Assumptions out of range — FCF growth −20…100%, cost of equity 5…20%, terminal 0…6% (≥1%
          below cost of equity), horizon 5…15 (whole years).
        </p>
      ) : inverted ? (
        <p className="scenario-note">These assumptions produce an inverted scenario set.</p>
      ) : hasShares && results ? (
        <p className="scenario-note">
          Range ≈ {formatCurrency(results[0].perShare, currency)} – {formatCurrency(results[2].perShare, currency)} per share.
        </p>
      ) : null}

      <p className="hint">
        {hasShares
          ? 'Per share uses the latest annual diluted weighted-average share count (not point-in-time shares outstanding); share count is held constant — no forecasted buybacks or issuance.'
          : 'Per-share unavailable — no share count; showing equity value.'}
      </p>

      {valid && <SensitivitySection
        effectiveFcf={effectiveFcf}
        baseGrowthPct={growths.base}
        coePct={coe}
        terminalPct={terminal}
        years={years}
        currency={currency}
        shares={hasShares ? shares : null}
      />}
    </section>
  );
}

// Where the Base value comes from (explicit years vs terminal stub) and how it
// moves with the two least-tuned assumptions. Deterministic, no probabilities.
function SensitivitySection({
  effectiveFcf, baseGrowthPct, coePct, terminalPct, years, currency, shares,
}: {
  effectiveFcf: number; baseGrowthPct: number; coePct: number; terminalPct: number;
  years: number; currency: string | null; shares: number | null;
}) {
  const base = intrinsicDcf({
    fcf0: effectiveFcf, growth: baseGrowthPct / 100,
    discountRate: coePct / 100, terminalGrowth: terminalPct / 100, years,
  });
  const tc = terminalContribution(base);
  const grid = sensitivityGrid(effectiveFcf, baseGrowthPct / 100, years, coePct, terminalPct);
  const cell = (v: number | null) =>
    v == null ? 'n.m.' : shares != null ? formatCurrency(v / shares, currency) : formatMarketCap(v, currency);

  return (
    <div className="sensitivity">
      <p className={tc.dominant ? 'dcf-warn' : 'scenario-note'}>
        Terminal value is <strong>{Math.round(tc.fraction * 100)}%</strong> of the Base scenario&rsquo;s
        present value{tc.dominant
          ? ' — most of this value rests on the perpetuity assumption, not the explicit forecast.'
          : '.'}
      </p>
      <details className="sensitivity-details">
        <summary>Sensitivity: cost of equity × terminal growth ▾</summary>
        <p className="hint">
          Base-scenario {shares != null ? 'value per share' : 'equity value'} holding the FCF base,
          growth path, and horizon fixed. &ldquo;n.m.&rdquo; = terminal growth too close to the cost of
          equity for the math to hold. Assumptions, not probabilities.
        </p>
        <div className="peers-scroll">
          <table className="ft-table sensitivity-table">
            <thead>
              <tr>
                <th>Terminal \ CoE</th>
                {grid.coePcts.map((c, i) => (
                  <th key={c} className={i === grid.center.coeIdx ? 'sens-center' : undefined}>{c}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.terminalPcts.map((tg, ti) => (
                <tr key={tg}>
                  <th scope="row" className={ti === grid.center.terminalIdx ? 'sens-center' : undefined}>{tg}%</th>
                  {grid.values[ti].map((v, ci) => (
                    <td
                      key={ci}
                      className={ti === grid.center.terminalIdx && ci === grid.center.coeIdx ? 'sens-center' : undefined}
                    >
                      {cell(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
