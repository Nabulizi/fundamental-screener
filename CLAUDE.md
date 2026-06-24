# CLAUDE.md

Guidance for working in this repo. Keep it current when conventions change.

## Project

Next.js 14 (App Router, TypeScript) fundamental screener. A user enters a watchlist of
tickers and gets a sortable comparison table of 13 columns (Symbol, Score,
Mkt Cap, Price, YTD, 52W Range, P/E TTM, P/E Fwd, Div Yld, FCF Yld, Rev Grw,
D/E, EV/EBITDA) plus a weighted composite scoring system (10 criteria, tier
weights ×3/×2/×1, split into a Strength Score 0–17 and a Risk Score 0–16, with
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
```

Before claiming work is done, run `npm test`, `npm run typecheck`, `npm run lint`,
and `npm run build` — CI runs all four on push/PR (`.github/workflows/ci.yml`).

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
- `lib/scoring.ts` — weighted composite scoring (10 criteria, 3 tier weights),
  split into a Strength Score (0–17) and Risk Score (0–16). Pure functions:
  `computeBreakdown`, `computeScores`, `scoreRow`, `isDisqualified`, `isCrowded`,
  `tierFor`, plus `isCyclicalIndustry`/`isFinancialIndustry`. Neutral tiers:
  `'strong' | 'moderate' | 'weak'`. `totalScore` (strength − risk) is retained
  as a convenience.
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
- The results table must fit on desktop without horizontal scroll; 52-week
  low/high are shown inside the range cell, not as separate columns.

## Environment

Copy `.env.example` to `.env.local` (git-ignored). `FINNHUB_API_KEY` is required
(supports comma-separated multiple keys for combined rate limits);
`ALPHAVANTAGE_API_KEY` is optional (enables failover). `MAX_TICKERS` (default 20),
`NEXT_PUBLIC_MAX_TICKERS` (default 20), and `CACHE_TTL_SECONDS` (default 60) are
optional.

> The local `.env.local` may contain `NODE_TLS_REJECT_UNAUTHORIZED=0` as a
> corporate-proxy workaround. It disables TLS verification (insecure); the proper
> fix is `NODE_EXTRA_CA_CERTS` pointing at the org root CA. Don't commit it.

## Gotchas

- In this sandbox, outbound HTTPS to providers goes through a TLS-intercepting
  proxy, so live scans/probes from the agent fail unless `NODE_TLS_REJECT_UNAUTHORIZED=0`.
  The user's machine reaches the providers normally.
- The in-memory server cache is best-effort on serverless (per-instance).
- Alpha Vantage free tier is ~25 req/day + ~1 req/sec; `OVERVIEW` (fundamentals)
  is fetched first, `GLOBAL_QUOTE` (price) is best-effort so a throttled price
  call never discards the fundamentals.
- **Scoring system:** `lib/scoring.ts` uses tier weights (×3 Survival, ×2
  Fundamental, ×1 Timing) split into Strength (positives) and Risk (negatives).
  Hard floors force a "Weak" tier: a −1 on Earnings Quality or Leverage (a Tier 1
  elimination), or a Risk Score ≥ 8. Adjustments: P/E compression is neutralized
  for cyclicals (semis/autos); D/E is neutralized for financials and for
  buyback-distorted equity (negative or D/E > 10, see `EXTREME_DE_RATIO`); a
  mega-cap ($200B+) near its 52-week high is capped at Moderate.
  Tiers by Strength: 12+ Strong, 7–11 Moderate, <7 Weak. The breakdown +
  Strength/Risk/flags are visible per-row via an expandable detail row.
- `SortKey` includes `'score'` which is not a `ScanRow` field — `sortRows`
  accepts an optional `scoreMap` parameter for this virtual column.
