# CLAUDE.md

Guidance for working in this repo. Keep it current when conventions change.

## Project

Next.js 16 (App Router, TypeScript) fundamental screener. A user enters a watchlist of
tickers and gets a sortable comparison table of 13 columns (Symbol, Score,
Mkt Cap, Price, YTD, 52W Range, P/E TTM, P/E Fwd, Div Yld, FCF Yld, Rev Grw,
D/E, EV/EBITDA) plus a weighted composite scoring system (12 criteria, tier
weights ×3/×2/×1, split into a Strength Score 0–21 and a Risk Score 0–20, with
hard-floor disqualifiers and cyclical/financial/crowding adjustments).
Informational only — the UI must never give buy/sell advice or imply missing
data equals zero; signal tiers are neutral (Strong / Moderate / Weak).

## Commands

```bash
npm run dev        # local dev at http://localhost:3000
npm test           # vitest (all network is mocked — no live calls)
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
npm run build      # production build
npm run probe      # live provider field-map check (needs keys in .env.local)
npm run probe -- --pit  # financials-reported PIT/versioning check
npm run export:pit # raw financials-reported export for should-i-trade PIT v0
```

Before claiming work is done, run `npm test`, `npm run typecheck`, `npm run lint`,
and `npm run build` — CI runs all four on push/PR (`.github/workflows/ci.yml`).

## Research / backtest

`npm run probe -- --pit` found deep dated annual history but **no multiple
filed versions per fiscal year**, so Finnhub is not restatement-safe PIT. The
current path is a caveated v0 plumbing harness: run `npm run export:pit` here,
then `python3 pit_backtest.py` in `../should-i-trade`. Full decision, caveats,
and harness location live in `docs/quant-research-plan.md`.

## Architecture

- `app/api/scan/route.ts` — server-only endpoint. Reads API keys from env here;
  **never import a provider adapter into client code** or the key could be
  bundled for the browser.
- `lib/provider.ts` — the `QuoteProvider` interface + `ProviderError`. Everything
  downstream depends on the normalized `ScanRow`, not any provider's wire format.
- `lib/finnhub.ts` — primary provider. `lib/alphavantage.ts` — failover.
  `lib/fallbackProvider.ts` composes them (tries each in order).
- `lib/scan.ts` — per-ticker orchestration with bounded concurrency + cache.
- `lib/clientScan.ts` — drives the scan one ticker at a time from the browser for
  real "X of N" progress (one POST per ticker).
- `lib/scoring.ts` — weighted composite scoring (12 criteria, 3 tier weights),
  split into a Strength Score (0–21) and Risk Score (0–20). Pure functions:
  `computeBreakdown`, `computeScores`, `scoreRow`, `isDisqualified`, `isCrowded`,
  `tierFor`, plus `isCyclicalIndustry`, and the ticker-aware
  `classifyFinancialModel(ticker, industry)` / `isBalanceSheetFinancial` (which
  wrap the `isFinancialIndustry` regex with curated overrides — the single
  predicate the scorecard neutralization AND the detail-page DCF gate share).
  Neutral tiers:
  `'strong' | 'moderate' | 'weak'`. `totalScore` (strength − risk) is retained
  as a convenience.
- `lib/snapshotStore.ts` — append-only JSONL scan history (`data/snapshots.jsonl`,
  git-ignored): first fresh result per ticker per local day, raw row + score
  computed at write time + `SCORING_VERSION` stamp. `recordSnapshots` NEVER
  throws; disable with `SNAPSHOTS_DISABLED=1`. Summary: `npm run snapshots`.
- `lib/store/` — durable snapshot store behind an **async** `Store` interface
  (`index.ts`) so a Turso/Postgres adapter can drop in later. `sqlite.ts` is the
  local better-sqlite3 adapter (`data/screener.db`, git-ignored), `require`d
  LAZILY so a native-load failure is caught: `getStore()` returns `null` and
  durable snapshots silently disable — scans/pages never break. The JSONL file
  stays the backup; `importJsonlOnce` seeds the DB from it (idempotent).
  `recordSnapshots` writes to BOTH when passed a store. `lib/snapshotHistory.ts`
  (pure) selects the comparison snapshot (closest at/before ~30 days, else oldest
  prior) and reuses `computeChangeSince`; rendered by `components/SnapshotHistoryPanel`
  as the objective "vs ~N days ago" complement to the client "since you last viewed".
- `lib/circuitBreaker.ts` — per-ticker failure tracking; skips after 3 failures
  for 60 s cooldown.
- `lib/fearGreed.ts` + `app/api/feargreed/route.ts` — CNN Fear & Greed badge.
- `lib/{tickers,filters,sort,format,csv,shareUrl,range,freshness}.ts` — pure,
  heavily-tested helpers. UI in `app/page.tsx` + `components/`.

## Conventions (important)

- **Provider-specific logic stays inside the adapter.** To add a provider:
  implement `QuoteProvider`, normalize into `ScanRow`, append it to the
  `providers` array in `route.ts`, and add a probe section to `scripts/probe.mjs`.
- **Missing vs zero is load-bearing.** Every `ScanRow` field is always present;
  `null` means unavailable (renders "N/A"). A real `0` (e.g. a non-dividend payer)
  is preserved and rendered (e.g. "0.00%"). Never coerce missing → 0. Sorting and
  filters push `null` last; filters fail an active numeric filter on `null` unless
  "include unavailable" is set.
- **Unit quirks differ per provider — verify with `npm run probe`, don't guess:**
  - Finnhub: market cap in **millions** (×1e6); dividend yield already a **percent**.
  - Alpha Vantage: market cap in **raw** units; dividend yield a **decimal** (×100).
  - Finnhub `profile.currency` is the *reporting* currency; for US-listed ADRs the
    trading currency (USD) is derived from `exchange` in `resolveTradingCurrency`.
- **Rate limits:** exactly **one** Retry-After-aware 429 retry (`lib/retry.ts`) —
  do not increase it. The fallback provider takes over on `RATE_LIMITED` /
  `PROVIDER_ERROR`, but not on `NOT_FOUND`.
- **Tests mock the network.** No live API calls in tests/CI; live checks live only
  in `scripts/probe.mjs`. Adapters accept injected `fetchImpl`/`sleep` via
  `RetryOptions` for deterministic testing.
- The results table keeps 52-week low/high inside the range cell. Narrow layouts
  may use a horizontally scrollable comparison view; essential evidence must also
  have a compact mobile presentation.

## Environment

Copy `.env.example` to `.env.local` (git-ignored). `FINNHUB_API_KEY` is required
(supports comma-separated multiple keys for combined rate limits);
`ALPHAVANTAGE_API_KEY` is optional (enables failover). `MAX_TICKERS` (default 20),
`NEXT_PUBLIC_MAX_TICKERS` (default 20), and `CACHE_TTL_SECONDS` (default 60) are
optional.

> Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`. It disables TLS verification. For a
> corporate proxy, install the org root CA and use `NODE_EXTRA_CA_CERTS` instead.

## Gotchas

- In restricted environments, outbound HTTPS to providers may require the
  environment's trusted CA bundle. Do not bypass TLS verification to work around
  that; use the appropriate CA configuration or treat live probes as unavailable.
- The in-memory server cache is best-effort on serverless (per-instance).
- Alpha Vantage free tier is ~25 req/day + ~1 req/sec; `OVERVIEW` (fundamentals)
  is fetched first, `GLOBAL_QUOTE` (price) is best-effort so a throttled price
  call never discards the fundamentals.
- **Scoring system:** `lib/scoring.ts` uses tier weights (×3 Survival, ×2
  Fundamental, ×1 Timing) split into Strength (positives) and Risk (negatives).
  Hard floors force a "Weak" tier: a −1 on Earnings Quality or Leverage (a Tier 1
  elimination), a Risk Score ≥ 8, or insufficient data coverage (below).
  Earnings Quality is the FCF/NI **conversion ratio** (`fcfYield × PE / 100`;
  +1 > 1.0, −1 < 0.7 — valuation-neutral by construction; do NOT revert to an
  absolute yield-gap, which is biased against low multiples). **Graduated
  eliminators** (binary cliffs on noisy TTM data are below institutional
  evidence standards): an EQ −1 disqualifies only when unambiguous — FCF < 0
  or conversion < `EQ_CONVERSION_CRITICAL` (0.5); the soft band 0.5–0.7 costs
  Risk and CAPS the tier at Moderate (`softEarningsQuality` flag). Waiver: a
  benign growth/capex drag — FCF yield ≥ 2% and revenue growth > 20%
  (`isBenignEarningsQuality`) — suppresses both the floor and the cap;
  negative/weak FCF never qualifies, preserving cash-burn protection.
  **Leverage is coverage-first**: interest coverage < `WEAK_INTEREST_COVERAGE`
  (2) scores −1 at ANY D/E (can't service debt = fatal); a D/E > 2 −1 with
  coverage ≥ `STRONG_INTEREST_COVERAGE` (6) keeps its Risk points but is
  WAIVED from disqualification (`serviceableLeverage` flag — the DELL case);
  coverage missing or middling (2–6) stays disqualifying (conservative).
  Cause attribution for the disqualification banner comes from
  `disqualificationCauses()` — the UI must not re-derive waiver logic. Adjustments: P/E compression is ASYMMETRIC for
  cyclicals (broad pattern set: semis, autos, energy, metals/mining, chemicals,
  steel, marine, airlines, construction/building, paper — a +1 is suppressed,
  a −1 from estimates rolling over still scores); for **financials** ALL
  FCF-derived criteria
  (Earnings Quality, FCF Level, Dividend Coverage) plus EV/EBITDA and D/E are
  neutralized (P/FCF and EBITDA are noise for banks/insurers — verified live);
  **REITs** get D/E neutralized (structural leverage) but keep FCF criteria;
  a distorted D/E (negative or > `EXTREME_DE_RATIO` 10) is arbitrated by
  interest coverage (`netInterestCoverageTTM` → `ScanRow.interestCoverage`):
  coverage < `WEAK_INTEREST_COVERAGE` (2) → −1 (fatal, disqualifies), else
  neutral — buyback distortion (MCD) stays waived, loss-wiped equity doesn't;
  a mega-cap ($200B+) near its 52-week high is capped at Moderate.
  **Known consequences (intentional, reviewed):** financials' maximum
  achievable Strength is 11 (five criteria neutralized) so they can never
  tier Strong — a deliberate limited-scorecard stance until a
  financial-specific template exists; and coverage cannot distinguish
  "provider gap" from "structurally inapplicable" (loss-makers have P/E
  normalized to null), so sparse unprofitable names tend toward the
  insufficient-data floor — conservative by design.
  **Trap gates** (both cap the tier at Moderate + flag, because a falling
  price/peaking earnings improves four criteria at once while decline shows in
  at most one −2 signal): `isValueTrap` — optically cheap (EV/EBITDA < 8 or
  FCF yield > 8%, `TRAP_CHEAP_*`) with shrinking revenue; `isPeakCycle` —
  cyclical, optically cheap on trailing numbers, forward P/E > trailing
  (estimates rolling over).
  **Improvement criteria** (×2 each, from `metric=all` fields already
  fetched): Revenue Acceleration — quarterly YoY vs TTM YoY, ±3pp band
  (`REV_ACCEL_THRESHOLD_PP`); Margin Inflection — TTM operating margin vs its
  5Y average, ±1pp band (`MARGIN_INFLECTION_PP`). They score the DERIVATIVE
  (turnaround/pre-recognition detection); tier thresholds are deliberately
  unchanged (12+ Strong, 7–11 Moderate), so rows without the data are
  unaffected and improvement can legitimately lift a tier. Max scores are
  Strength 21 / Risk 20 — use `MAX_STRENGTH`/`MAX_RISK`, never literals.
  **Data guards:** implausible revenue growth is neutralized + flagged, never
  scored (`sanitizeRevenueGrowth`, and `sanitizeQuarterlyRevGrowth` for the
  acceleration input: financials > 60%, anyone > 300% — Finnhub returned
  108.98% for JPM live) and never grants the benign-EQ waiver;
  `computeCoverage` counts applicable criteria with data (deliberately-
  neutralized ones excluded from the denominator) and `hasInsufficientData`
  (coverage < 0.7, or missing FCF/D/E where applicable) floors the tier to
  Weak — a null input can never score −1, so sparse rows must not look safer
  than covered ones. Tiers by Strength: 12+ Strong, 7–11 Moderate, <7 Weak.
  The breakdown + Strength/Risk/coverage/flags are visible per-row via an
  expandable detail row.
- `SortKey` includes `'score'` which is not a `ScanRow` field — `sortRows`
  accepts an optional `scoreMap` parameter for this virtual column.
- **Bump `SCORING_VERSION`** (`lib/scoring.ts`) whenever criteria, thresholds,
  or weights change — snapshots stamp it to separate methodology eras. Bump
  `SNAPSHOT_SCHEMA_VERSION` (`lib/snapshotStore.ts`) only if the JSONL line
  format changes. A version bump also requires an entry in the evidence
  registry (`lib/evidence.ts`) for the new version — default verdict
  `untested` — or `test/evidence.test.ts` fails.
