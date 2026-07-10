# Quant research plan (fundamental rank/rebalance)

Research engine first, execution never before an honest edge. The goal is a
monthly "rank top N by Strength Score, rebalance next bar" backtest of the
scorecard — **not** an intraday trading system. If the research loop can't show
an edge after costs + bias controls, automating execution just loses faster.

## Current verdict

`npm run probe -- --pit` answered the gate: Finnhub `/stock/financials-reported`
has deep dated annual history, but the sampled response had **0/15 tickers with
more than one `filedDate` for a fiscal year**. That means the data can prevent
pre-filing lookahead (`filedDate <= signal_date`) but cannot prove
restatement-safe point-in-time fundamentals.

The repo therefore has a **v0 plumbing harness only**, not a believable trading
edge test:

- `npm run export:pit` in this repo writes raw annual `financials-reported`
  payloads to `data/pit/`.
- `python3 pit_backtest.py` in `../should-i-trade` runs the caveated fixed-
  universe monthly FCF-yield rank/rebalance test, including a no-ranking
  equal-weight eligible-universe null control.
- `python3 pit_backtest.py --selftest` is the offline runnable check.

## EDGAR feasibility spike result

Ran `should-i-trade/edgar_pit_spike.py` (throwaway diagnostic) to test whether
SEC EDGAR can supply restatement-safe, as-first-reported annual fundamentals —
the thing Finnhub cannot. Method deliberately avoids the `/api/xbrl/frames` API
(it picks one last-filed fact per period = the restatement leak); uses
`submissions` + `companyfacts` filtered **by original 10-K accession**.

- **Q1/Q2 PASSED** — the original 10-K accession + filed date is identifiable
  per fiscal year, and filtering facts by that accession returns as-first-reported
  values while **excluding later comparative/restated re-reports** of the same
  period. Verified: AAPL `0000320193-20-000096` (filed 2020-10-30), Exxon
  `0000034088-23-000020` (filed 2023-02-22).
- **Q4 PASSED** — a delisted filer still resolves by CIK: Twitter
  `0001418091` returns submissions + companyfacts years after its 2022 delisting.
- **Q3 not observed, not failed** — no 10-K/A amendment fell in the sampled
  fiscal years; the `amendments()` path exists to catch them.
- **Known friction (Q5):** ticker→CIK mapping is noisy (XOM resolved to a
  holding entity with no recent 10-K — a real loader must key off **CIK**, not
  ticker); non-calendar fiscal years (AAPL = Sept) mean keying off actual
  `reportDate`, never assuming Dec-31; `submissions.recent` caps at ~1000 filings
  (older ones paginate under `filings.files[]`).
- **What EDGAR does NOT solve:** it has **no prices and no tradable-universe
  membership.** Restatement-safe fundamentals joined to survivorship-biased or
  missing delisted prices is still a biased backtest.

**Gate before building an EDGAR loader:** prove **delisted price/return data**
first (next spike). Fundamentals without matching delisted prices cannot produce
an honest return series, so the loader is premature until prices are sourced.

## Delisted price feasibility spike result

Ran `should-i-trade/delisted_price_spike.py` against 5 dead names (TWTR, LEHMQ,
CELG, ATVI, XLNX) on free sources. The diagnostic distinguishes "source blocked"
from "symbol absent" (and Yahoo now maps HTTP 404 → absent, network → blocked) so
the verdict can't misread an access failure as missing data.

- **Yahoo = structural NO.** AAPL control returns normal data; the acquired names
  (TWTR/ATVI/XLNX/CELG) return HTTP 404 "symbol may be delisted", and LEHMQ
  returns HTTP 200 with an empty payload. Yahoo purges delisted symbols — it
  cannot supply survivorship-free history.
- **Stooq = HONESTLY UNKNOWN.** Its CSV endpoint returns HTML even for live
  `aapl.us` in the test environment (blocked/rate-limited), so Stooq was never
  actually queried. Not ruled out — but not proven either. Testing it needs a
  different access path (`stooq.pl`, referer/cookie, or slower requests).
- **The hard part remains regardless:** even if Stooq resolves, free daily CSV is
  *unadjusted* and does not encode the acquisition cash-out / bankruptcy terminal
  return — the exact leg a survivorship-free backtest needs.

**Verdict: free delisted price data is not proven viable.** An honest
survivorship-free backtest likely needs a **paid** delisted price/return source
— Sharadar SEP (cheap end, pairs with SF1), or CRSP / Norgate. Do NOT build the
EDGAR loader until the price source is decided; restatement-safe fundamentals
joined to missing delisted prices is still a biased backtest.

## The original gate

- **>1 `filedDate` for a fiscal year** → real point-in-time is available. Build
  the as-of-date loader: per FY, select `latest filedDate <= as-of date`. Green
  light for the real backtester.
- **One version/FY but deep filed history** → dated history only. Build v0
  plumbing gated by `filedDate` (avoids the crude lookahead of using a FY before
  it was filed) but restatements are baked in — **results not believable, plumbing
  only.** Restatement-safe PIT needs a real provider (Sharadar SF1 or equivalent
  — "Sharadar" here means "any true PIT source", not the only option).
- **Shallow filed span** → too little history (a 2–3yr backtest is noise). Stop
  and source better data first, regardless of versioning.

## What exists vs what's missing

- `should-i-trade/backtest.py` — honest-ish SPY price/regime backtest.
- `should-i-trade/pit_backtest.py` — v0 fundamental plumbing harness, fed by the
  raw `npm run export:pit` dump from this repo. It is stdlib-only, not pandas.
  It reports both the ranked strategy and an equal-weight eligible-universe null
  control, because the fixed survivor basket is likely the dominant bias. Do not
  build the backtester inside this Next app.
- `lib/valuationProvider.ts` — already parses `financials-reported`, reads
  `filedDate` (line ~74) but collapses to the *most-restated* view per FY and
  drops the dates. For PIT: keep all versions, carry `filedDate`/`endDate` through.
- `lib/finnhub.ts` `metric=all` fields (peTTM, pfcfShareTTM…) are **current-only
  snapshots — useless for backtest.** Only `financials-reported` has dated history.
- **Universe membership history: missing everywhere.** For a v0, hardcode a fixed
  liquid set and accept survivorship bias explicitly (`// ponytail: fixed universe,
  survivorship-biased, not tradeable until membership history lands`).
- `lib/snapshotStore.ts` forward-collection is the one genuinely as-known PIT
  dataset owned here. Worthless for a backtest today (days old), but a clean
  *forward* validation set in 6–12 months. Keep it running regardless.

## Harness guardrails (these are the strategy, not a framework — ~150 lines)

signal-date vs trade-date split · next-bar execution · costs + slippage ·
benchmark comparison · turnover · max drawdown · out-of-sample split ·
no current-data leakage · risk rules as backtest inputs (max position, max
sector exposure, max daily/weekly loss, no-trade-on-stale-data).
