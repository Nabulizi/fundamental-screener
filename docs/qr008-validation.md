# QR-008: preregistered historical validation of the v5 scorecard

The Strength/Risk composite this app ships (methodology v5, frozen at commit
`0fa9049`) was tested by the independent research program in
[Nabulizi/quant-research](https://github.com/Nabulizi/quant-research) as
experiment **QR-008**. This document is the app-side summary; the
authoritative record (preregistration, ledger, audit, monthly shadow log)
lives in that repository.

## What was tested

- **Construction:** long-only, equal-weight portfolio of every US stock the
  shipped v5 scorer tiers **Strong**, rebalanced monthly, top-500-by-market-cap
  universe, on point-in-time survivorship-free data (QuantConnect).
- **Exact-logic guarantee:** the backtest ran a Python port of
  `lib/scoring.ts` proven identical on the 37 golden fixtures in
  [`test/fixtures/scoring-v5-golden.json`](../test/fixtures/scoring-v5-golden.json)
  (see `test/scoringFixtures.test.ts`).
- **Preregistered pass rule (frozen before the run):** net Sharpe 2011-2022
  must beat both the 75th percentile of 100 breadth-matched random-control
  portfolios and equal-weight top-100.

## Result: PASS, with audited scope

Over 2011-2022 (144 months, 10 bps/side costs, survives 20 bps):

| | Sharpe | CAGR | MaxDD |
|---|---|---|---|
| Strong-tier EW | 1.04 | 15.0% | -18.9% |
| EW top-100 | 0.82 | 11.2% | -24.1% |
| SPY | 0.85 | 11.8% | -23.9% |

- Beat **all 100** random controls (their best: 0.87).
- Audit: beta 0.96 vs SPY (fully invested, not a low-risk tilt); selection
  alpha **+4.2%/yr vs its own universe (t = 3.8)**; not carried by one
  sector or subperiod; ~20%/month one-way turnover.
- **2023-2026 (previously viewed window):** matched the equal-weight
  universe (alpha ≈ 0) and lagged cap-weighted SPY — the mega-cap regime,
  not negative selection. The recent evidence is neutral, not positive.

## What this does and does not mean

- It is **historical** evidence for one construction (Strong-tier EW,
  top-500, monthly) over one window. It is not a prediction, not a
  guarantee, and not investment advice.
- It does not validate individual scores, other cap tiers, other holding
  periods, or the Moderate/Weak tiers.
- Since 2026-08 the frozen strategy is under monthly **prospective shadow
  observation** (picks committed publicly before returns exist) — the first
  evidence free of all historical-testing caveats. See
  `results/QR-008-strength-risk-v5/shadow/` in the research repo.

## Reproducibility

Preregistration frozen at `quant-research@d8419d5`; valid QC backtest
`9bb76ea828c3f4e8575e097a8b973ca3`; audit reproducible via
`results/QR-008-strength-risk-v5/audit.py` in the research repo. Scoring
changes here bump `SCORING_VERSION` and reset the evidence status for the
new version to `untested` (see `lib/evidence.ts`).
