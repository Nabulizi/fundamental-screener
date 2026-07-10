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
