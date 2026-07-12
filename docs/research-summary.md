# Research summary: building an honest quant research loop (and killing a bad signal)

Capstone for the work logged in `qc-experiment-log.md` and `quant-research-plan.md`.
The outcome is a validated research process and a **falsified** signal -- which is
the process working, not failing.

## 1. Data path -- VALIDATED

The whole project gated on one hard problem: an honest backtest needs
survivorship-free prices with correct terminal returns and point-in-time
fundamentals, and free sources (Yahoo, Stooq, akshare) cannot provide it -- they
scrape public sites that purge delisted names.

- Finnhub gave dated fundamentals but only one `filedDate` per fiscal year
  (restatement-unsafe) and no delisted prices -> only a caveated plumbing harness.
- EDGAR spike proved restatement-safe as-first-reported fundamentals are reachable
  (incl. delisted CIKs), but EDGAR has no prices.
- Free delisted price data does not exist in usable form (Yahoo purges delisted;
  Stooq blocked/untested) -> a paid source looked required.
- **QuantConnect (free tier) resolved it:** verified to handle delistings and
  terminal returns correctly (TWTR->$54.20 cash, LEH->~0 bankruptcy, XLNX stock
  merger, CELG hybrid) and to serve point-in-time fundamentals with zero lookahead
  across 60 filings (incl. a delisted name). QC is validated as the research engine.

## 2. Signal tests (all preregistered)

1. Naive FCF-yield rank: FAILED. Same return as the universe, worse Sharpe, ~2x
   drawdown (cheap-FCF = value traps).
2. Quality + value (qv): looked promising. Beat random same-breadth portfolios
   in-sample at breadth 50/100 (Test 003 STRONG), survived costs to 50bps and was
   positive every OOS year (Test 004 STRONG).
3. Forward extension (2023-2026): PASSED but marginal -- a yellow flag.
4. Attribution EXPOSED A BUG: `fcf_yield`/`roe` could be NaN and pass the filter
   (isinstance(nan,float)=True), contaminating the ranking with ~130 names/month
   and inflating results.
5. Clean re-run (finite filters): in-period skill survives but smaller; **forward
   2023-2026 FAILS** -- qv falls below a random same-breadth portfolio at both
   breadths and loses to EW-500 and to a dumb EW-top-100.

## 3. Final verdict

**quality_value is falsified as a live candidate.** Real in-sample selection skill
(2010-2022) that did NOT persist out-of-period once the implementation bug was
removed. It is a market-beta portfolio (beta ~1.0, corr 0.97), not a durable edge,
and not a hidden sector/size bet. Do not paper trade, do not tune it.

## 4. Lessons (now mandatory for every future test)

- **Same-breadth nulls are required.** Comparing a 20-name portfolio to a 500-name
  universe confounds concentration with signal; the honest null is a random
  portfolio of the SAME size.
- **Finite/NaN filters are mandatory.** Every ranking input must be `math.isfinite`;
  NaN silently corrupts sorts and inflates results.
- **Forward extension is mandatory.** In-period OOS is not enough; only genuinely
  post-sample data catches stale-period artifacts.
- **Trivial benchmarks must be included** (EW-universe, EW-top-100-by-mktcap). If a
  zero-signal portfolio matches you, you have no edge.
- **Preregister hypothesis + pass/fail before running.** It is the only defense
  against moving the goalposts across many tests.

## 5. Suggested next hypothesis (NOT implemented)

Single-factor tilts on US large-caps are a crowded, efficient space -- weak priors
for durable alpha, consistent with what we found. A better-priored next hypothesis,
to run through the SAME gauntlet (same-breadth null, finite filters, forward
extension, trivial benchmarks, preregistered): a signal with a clearer economic
mechanism in a less-efficient universe -- e.g. a quality/value composite on US
small-caps (Russell 2000 range), where mispricing is more plausible. No code until
it is preregistered.

## The point

The good news is not "we found a strategy." It is that the process killed a bad
strategy before it cost money -- which is exactly what a quant research system is
for. The engine and the method remain; the next signal is cheap to test honestly.
