# QR-009: preregistered small-cap validation of the v5 scorecard

Companion to [qr008-validation.md](qr008-validation.md). Experiment QR-009 in
[Nabulizi/quant-research](https://github.com/Nabulizi/quant-research) tested
the same frozen v5 scorecard (commit `0fa9049`) in the **small-cap band** —
US market-cap ranks 501–1500 with a $2M/day liquidity floor — over the same
preregistered 2011–2022 window, at realistic small-cap costs (25 bps/side,
stressed at 50).

## Result: PASS within its band, with a sharp scope boundary

- Strong-tier equal-weight beat **all 100** breadth-matched random control
  portfolios (Sharpe 0.78 vs their best 0.67) and the band's equal-weight
  top-100 (0.61), net of costs; survives double costs.
- Audited selection alpha: **+3.7%/yr vs its own band (t = 3.4)** and
  **+4.9%/yr vs IWM (t = 3.5)**; not carried by any single year (removing
  2021 entirely leaves the result intact) or sector.
- **The boundary: zero S&P-relative alpha.** Vs SPY the strategy shows beta
  1.11 and alpha 0.08%/yr (t = 0.04). It picks small caps well but fully
  inherits small-cap asset-class returns, which lagged mega caps this whole
  era — SPY's Sharpe (0.85) exceeded the strategy's (0.78). Holding it is a
  small-cap allocation decision plus selection, **not** a market-beating
  machine.

## What this means for scores in this app

For small-cap tickers, a Strong tier has historically identified
better-than-peers names *within small caps*. It says nothing about small
caps vs the broader market, predicts nothing, and is not investment advice.
Since 2026-08 the frozen strategy is under monthly prospective shadow
observation in the research repo alongside its large-cap sibling (QR-008).

Reproducibility: preregistration frozen at `quant-research@8b9dac3`; valid
QC backtest `00e46e0e2ee3804e2eae7e9c7f1a4a99` (first and only run); audit
reproducible via `results/QR-009-smallcap-strength-risk-v5/audit.py`.
