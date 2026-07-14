# Scoring methodology changelog

## Version 5 — July 12, 2026

- Added a fail-closed scoring input boundary. Implausible provider values for P/E, FCF yield, dividend yield, market cap, price, EV/EBITDA, interest coverage, revenue growth, operating margins, and range position are treated as missing before criteria, coverage, and overlay rules run.
- Preserved raw provider values for provenance and source verification.
- No criteria, weights, or positive/negative thresholds changed.
- Evidence status remains **untested for return prediction**.

## Version 4

- Added the ticker-aware financial business-model classifier and its associated neutralization rules.
