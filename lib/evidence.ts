/**
 * Machine-readable evidence registry (P4-E): what has actually been tested,
 * with what verdict, and where the record lives. The UI renders this directly
 * so displayed claims can never drift ahead of the research record, and a
 * contract test fails any SCORING_VERSION bump that doesn't state the new
 * version's evidence status.
 *
 * Verdicts (from the validation program in docs/project-review-and-roadmap.md):
 * - untested:               no decision-grade test has been run
 * - inconclusive:           tested; evidence insufficient either way
 * - falsified:              preregistered test rejected the claim
 * - invalidated:            a result was withdrawn (methodology defect)
 * - supported-within-scope: passed its preregistered test; scope says how far
 */

export type EvidenceVerdict =
  | 'untested'
  | 'inconclusive'
  | 'falsified'
  | 'invalidated'
  | 'supported-within-scope';

export interface EvidenceEntry {
  id: string;
  /** The exact claim the verdict judges — not a topic, a testable statement. */
  claim: string;
  verdict: EvidenceVerdict;
  /** What the verdict covers and, just as important, what it does not. */
  scope: string;
  /** Repo document recording the evidence (must exist). */
  source: string;
  /** ISO date the verdict was last reviewed. */
  asOf: string;
  /** Set when the claim is about a specific scorecard version. */
  scoringVersion?: number;
}

export const VERDICT_LABEL: Record<EvidenceVerdict, string> = {
  untested: 'Untested',
  inconclusive: 'Inconclusive',
  falsified: 'Falsified',
  invalidated: 'Invalidated',
  'supported-within-scope': 'Supported within scope',
};

export const EVIDENCE_REGISTRY: EvidenceEntry[] = [
  {
    id: 'scorecard-v5-returns',
    claim: 'The 12-criterion scorecard (Strength/Risk, methodology v5) predicts cross-sectional excess returns.',
    verdict: 'supported-within-scope',
    scope:
      'Preregistered point-in-time test QR-008 (quant-research repo): Strong-tier equal-weight, top-500 US universe, 2011–2022 net of costs beat all 100 random controls and EW-top-100 (Sharpe 1.04 vs 0.82), selection alpha +4.2%/yr vs its own universe (t=3.8), beta ≈ 0.96. Covers that construction and window only — 2023–2026 matched equal-weight and lagged cap-weighted SPY; not a prediction or trading advice. Under prospective shadow observation since 2026-08.',
    source: 'docs/qr008-validation.md',
    asOf: '2026-07-15',
    scoringVersion: 5,
  },
  {
    id: 'scorecard-v5-smallcap-returns',
    claim: 'The v5 scorecard also selects outperformers within US small caps (market-cap ranks 501–1500).',
    verdict: 'supported-within-scope',
    scope:
      'Preregistered test QR-009 (quant-research repo): Strong-tier equal-weight in the 501–1500 band with a $2M/day liquidity floor, 2011–2022 net of 25 bps costs, beat all 100 random controls and the band top-100; selection alpha +3.7%/yr vs its band (t=3.4), +4.9%/yr vs IWM. Within-band only — vs SPY the alpha is 0.0%/yr (beta 1.11): the strategy fully inherits small-cap asset-class returns, which lagged mega caps this era. Not a prediction or trading advice.',
    source: 'docs/qr009-validation.md',
    asOf: '2026-07-15',
  },
  {
    id: 'scorecard-v4-returns',
    claim: 'The 12-criterion scorecard (Strength/Risk, methodology v4) predicts cross-sectional excess returns.',
    verdict: 'untested',
    scope:
      'No point-in-time test of the full live scorecard exists. The falsified quality/value family below shares some inputs but is a different, simpler model — its failure neither validates nor fully falsifies this scorecard.',
    source: 'docs/research-summary.md',
    asOf: '2026-07-12',
    scoringVersion: 4,
  },
  {
    id: 'fcf-yield-signal',
    claim: 'Ranking by trailing FCF yield alone selects stocks that outperform.',
    verdict: 'falsified',
    scope:
      'Preregistered survivorship-free backtest: same return as the universe, worse Sharpe, roughly double the drawdown (cheap-FCF selects value traps).',
    source: 'docs/qc-experiment-log.md',
    asOf: '2026-07-11',
  },
  {
    id: 'quality-value-family',
    claim: 'A quality + value composite (FCF yield with quality filters) is a durable live trading edge.',
    verdict: 'falsified',
    scope:
      'Real in-sample selection skill (2010–2022) did not persist forward (2023–2026) once a NaN-filter bug was fixed; behaves as a market-beta portfolio (beta ≈ 1.0, corr 0.97). Closed — do not tune or trade.',
    source: 'docs/research-summary.md',
    asOf: '2026-07-11',
  },
  {
    id: 'synthetic-control-extension',
    claim: 'The synthetic random-control and forward metrics in Tests 003–006 are reliable.',
    verdict: 'invalidated',
    scope:
      'Methodology audit found survivorship attrition: holdings leaving the eligible universe were dropped instead of realizing terminal returns. Those exact metrics are withdrawn; Test 002 (actual holdings) stands.',
    source: 'docs/qc-experiment-log.md',
    asOf: '2026-07-11',
  },
  {
    id: 'research-engine',
    claim: 'The backtest engine handles delistings, terminal returns, and point-in-time fundamentals without lookahead.',
    verdict: 'supported-within-scope',
    scope:
      'Verified on adversarial cases (TWTR cash-out, LEH bankruptcy, XLNX merger, CELG hybrid; 60 filings incl. a delisted CIK). Covers engine correctness only — no signal claim.',
    source: 'docs/research-summary.md',
    asOf: '2026-07-11',
  },
  {
    id: 'dcf-calculator',
    claim: 'The DCF/scenario outputs are calibrated forecasts of value.',
    verdict: 'untested',
    scope:
      'The DCF is a deterministic scenario calculator over user assumptions — internally consistent arithmetic, never empirically calibrated. Treated as a lens, not a forecast.',
    source: 'docs/project-review-and-roadmap.md',
    asOf: '2026-07-12',
  },
];

/**
 * The registry entry for the CURRENTLY SHIPPED scorecard version. A contract
 * test calls this with `SCORING_VERSION`; bumping the version without adding
 * an entry for it (default verdict: untested) fails CI.
 */
export function scorecardEvidence(scoringVersion: number): EvidenceEntry | undefined {
  return EVIDENCE_REGISTRY.find((e) => e.scoringVersion === scoringVersion);
}
