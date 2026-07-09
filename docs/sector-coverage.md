# Sector coverage — what's supported, what's skipped, and why

Roadmap item #7 was "narrow sector-native displays." A provider-capability check
(against Finnhub `metric=all`, `financials-reported`, and the AAPL/HOOD/PLD
fixtures) showed that **most sector-native metrics are not in the data**, so the
honest outcome is: **no sector-native UI is built.** This document is the receipt.

Run the capability probe yourself: `npm run probe -- --sector` (needs a live key).

## Current behavior (unchanged, and correct)
- **Balance-sheet financials** (banks, insurers, brokers holding customer assets,
  card lenders — see `classifyFinancialModel` in `lib/scoring.ts`) are **gated off
  the FCF-DCF** with a "not meaningful for financials" message, and the scorecard
  **neutralizes FCF-derived criteria** for them. That is the right default when we
  can't compute a sector-appropriate lens.
- REITs get D/E neutralized; their FCF stays null (real-estate acquisition is
  growth capex, not maintenance — see `lib/valuationProvider.ts`).

## Not supported — skipped, permanently, with reasons
| Metric | Sector | Why skipped |
|---|---|---|
| **AFFO / FFO**, occupancy, cap rates | REITs | AFFO/FFO are **non-GAAP supplement figures** — never in the standard `financials-reported` statements. Occupancy/cap rates aren't in the provider at all. |
| **Combined ratio, float, premiums** | Insurers | Combined ratio isn't a reported line; deriving it needs premium/loss/expense components that aren't reliably present. |
| **NIM, CET1, ROTCE, credit losses** | Banks | No net-interest-income or capital-ratio concepts in the standard statements; CET1/ROTCE are regulatory/non-GAAP. |
| **Reserves, production, FCF-at-price-deck** | Energy | Not financial-statement concepts. |
| **Rule of 40** | SaaS | Inputs (revenue growth, FCF margin) exist, but it's a **pass/fail verdict heuristic** requiring SaaS classification — against the "context, not scoring/verdict" rule. Both inputs are already shown neutrally in the driver strip. |

Building any of these would fabricate precision from absent data.

## Conditionally derivable — but NOT built yet (extraction hazards)
**P/B, ROE, book value** for balance-sheet financials are *conceptually* derivable
(`marketCap / stockholders' equity`, `net income / equity`), and this is exactly
the gap where the FCF-DCF is gated. But the fixture check found two extraction
hazards that make it unreliable without validation:

1. **Equity concept collision:** `us-gaap_StockholdersEquity` is a substring of
   `us-gaap_LiabilitiesAndStockholdersEquity` (total assets = L+E). A naive match
   grabs the *total*, giving a P/B off by ~5×. (AAPL's row resolved to the total.)
2. **Custom net-income namespaces:** e.g. PLD reports
   `amb_NetIncomeLossAvailableToCommonUnitholders`, which a `us-gaap_*` matcher
   misses; net income also has several us-gaap variants.

And critically: **there is no bank/insurer fixture in the repo to validate
against** — only AAPL (tech), HOOD (broker), PLD (REIT).

## What would be required before adding a P/B / ROE display
1. Run `npm run probe -- --sector` (banks/insurers/REITs) and confirm it prints
   **"P/B + ROE follow-up VIABLE"** — i.e. `metric=all` cleanly returns `pbAnnual`
   / `roeTTM`, **and** `financials-reported` yields an **unambiguous**
   `us-gaap_StockholdersEquity` (not the L+E total) and a resolvable net income
   for **every** probed financial.
2. Capture bank/insurer fixtures and add pure derivation tests (P/B, ROE, book
   value/share), including the equity-collision and net-income-namespace guards,
   and "skip when concepts are unresolved."
3. Only then: a small **"Financials context"** display (P/B · ROE · book value/
   share), scoped to `isBalanceSheetFinancial`, as neutral context — **not**
   scoring, **not** a verdict.

Until the probe validates that, the correct behavior is what's shipped: gate the
DCF for financials and show nothing we can't compute reliably.
