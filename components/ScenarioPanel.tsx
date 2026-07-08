'use client';

import { useState } from 'react';
import { computeScenarios, isInvertedRange, SCENARIO_PRESETS, type ScenarioLabel } from '@/lib/dcf';
import { formatCurrency, formatMarketCap } from '@/lib/format';

interface Props {
  /** The selected FCF base (raw currency units), guaranteed positive by ValuationPanel. */
  effectiveFcf: number;
  currency: string | null;
  /** Latest annual diluted weighted-average shares, or null when unavailable. */
  shares: number | null;
}

const LABELS: Record<ScenarioLabel, string> = { bear: 'Bear', base: 'Base', bull: 'Bull' };
const pct = (d: number) => Math.round(d * 100);

// Assumption-driven value-per-share RANGE — informational only, never a fair
// value or target. Per-scenario variable is FCF growth ONLY; cost of equity,
// terminal growth, and horizon are shared (company-level). No upside/downside,
// no current-price comparison, no red/green verdicts.
export default function ScenarioPanel({ effectiveFcf, currency, shares }: Props) {
  const [growths, setGrowths] = useState({
    bear: pct(SCENARIO_PRESETS.growths.bear), base: pct(SCENARIO_PRESETS.growths.base), bull: pct(SCENARIO_PRESETS.growths.bull),
  });
  const [coe, setCoe] = useState(pct(SCENARIO_PRESETS.shared.costOfEquity));
  const [terminal, setTerminal] = useState(pct(SCENARIO_PRESETS.shared.terminalGrowth));
  const [years, setYears] = useState(SCENARIO_PRESETS.shared.years);

  const setGrowth = (k: ScenarioLabel, v: number) => setGrowths((g) => ({ ...g, [k]: v }));

  // Terminal must sit ≥100bps below cost of equity (r≈g explodes the terminal value).
  const valid = terminal <= coe - 1;
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
      <h2>Scenario range (assumption-driven)</h2>
      <p className="hint">
        {hasShares ? 'Value per share' : 'Equity value'} under Bear / Base / Bull{' '}
        <strong>FCF-growth</strong> assumptions, off the selected FCF base. Not a fair value, price
        target, or recommendation — informational only.
      </p>

      <div className="scenario-cols">
        {(['bear', 'base', 'bull'] as ScenarioLabel[]).map((label) => {
          const r = results?.find((x) => x.label === label);
          return (
            <div key={label} className="scenario-col">
              <span className="scenario-name">{LABELS[label]}</span>
              <label className="scenario-growth">
                FCF growth
                <span>
                  <input type="number" value={growths[label]} min={-20} max={40}
                    onChange={(e) => setGrowth(label, Number(e.target.value))} />%/yr
                </span>
              </label>
              <span className="scenario-value">{r ? cellValue(r.equityValue, r.perShare) : '—'}</span>
            </div>
          );
        })}
      </div>

      <div className="scenario-shared">
        <SharedInput label="Cost of equity" value={coe} set={setCoe} min={5} max={20} suffix="%" />
        <SharedInput label="Terminal growth" value={terminal} set={setTerminal} min={0} max={6} suffix="%" />
        <SharedInput label="Horizon" value={years} set={setYears} min={5} max={15} suffix="yr" />
      </div>

      {!valid ? (
        <p className="dcf-warn">Terminal growth must be at least 1% below cost of equity.</p>
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
    </section>
  );
}

function SharedInput({
  label, value, set, min, max, suffix
}: { label: string; value: number; set: (n: number) => void; min: number; max: number; suffix: string }) {
  return (
    <label className="scenario-shared-input">
      <span>{label}</span>
      <span>
        <input type="number" value={value} min={min} max={max} onChange={(e) => set(Number(e.target.value))} />{suffix}
      </span>
    </label>
  );
}
