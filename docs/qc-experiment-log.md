# QuantConnect experiment log (preregistered)

Discipline against data mining: each test's hypothesis, signal construction,
universe, null controls, and PASS/FAIL criteria are written and committed BEFORE
the test is run. No parameter mining. Fixed across all tests unless a test
explicitly preregisters a change: TOP_N=20, monthly rebalance, 2010-2022,
top-500-by-market-cap US universe (price>5), QuantConnect survivorship-free data,
engine-level point-in-time. Results are appended after running; PASS/FAIL is
judged only against the criteria stated beforehand.

Code: `should-i-trade/quantconnect_v0_fcf_strategy.py` (Test 001) and
`should-i-trade/quantconnect_quality_value.py` (Test 002+, MODE toggles the arm).

## CONCLUSION after clean re-run (post-NaN-fix, commit fba1cc2): qv100 is NOT a tradeable edge

A NaN sanitation bug (fcf_yield/roe could be NaN; isinstance(nan,float)=True) had
contaminated the ranking with ~130-143 names/month (dropped_nan logs) since Test
002, sorted arbitrarily -- and it had INFLATED results. Re-running Tests 002-006
frozen on clean data:

- IN-PERIOD (2010-2022): edge survives but smaller. Test 004 clean B50 Sharpe
  0.92@10bps (>hd p90 0.91), B100 0.97 (>p90 0.89), robust to 50bps; Test 003 qv
  beats random median at all breadths (STRONG at 100). Real modest in-sample skill.
- FORWARD (2023-2026), the decisive test: FAIL. Test 005 clean FWD B50 qv 0.97 <
  hd median 0.99; B100 qv 1.03 < hd median 1.04 -- BELOW a random same-breadth
  portfolio at both breadths. Test 006 clean FWD qv 1.04 < EW500 1.09 < EWtop100
  1.26. Forward it loses to random, to equal-weight-500, and to the dumb top-100.
- Attribution: not a sector/size bet (Tech +4.9%, Utils -5.1% moderate tilts; size
  0.54; beta ~1.0, corr 0.97). Factor construction confirmed (qv FCF yield 0.092 vs
  0.048, ROE 1.35 vs 0.46). Just a market-beta portfolio that did not select well
  forward.

VERDICT: quality_value had real in-sample selection skill (2010-2022) that DID NOT
PERSIST out-of-period. Once the implementation bug was removed, the forward edge
went with it. Not a candidate strategy. Do NOT paper/live trade it.

Value of the process: the discipline (null controls, breadth-matching, cost
robustness, forward extension, and the attribution that exposed the NaN bug) did
its job -- it stopped a signal that looked strong in-sample from reaching real
money on a false positive. The free survivorship-free QC research engine + the
preregistration/experiment-log method remain, ready for the next hypothesis.

---

## Test 001 -- naive FCF-yield rank  [RUN: FALSIFIED]

- Hypothesis: ranking the universe by FCF yield (cheap = good) beats holding it.
- Signal: top-20 by `valuation_ratios.fcf_yield`, equal weight, monthly.
- Null: equal-weight the whole eligible universe ("all").
- Result: RANK 13.04% CAGR / 0.65 Sharpe / -41.93% MaxDD vs ALL 12.78% / 0.91 / -22.54%.
- Verdict: FALSIFIED. Same return, worse Sharpe, ~2x drawdown. Cheap-FCF names are
  value traps.

---

## Test 002 -- value + quality  [RUN: FAIL (per preregistered criteria)]

Result (2010-2022, same universe/costs, 3 arms from one file):

| Arm | CAGR | Sharpe | MaxDD | IS Sharpe | OOS Sharpe |
|---|---|---|---|---|---|
| quality_value | 16.83% | 0.86 | -29.74% | 1.01 | 0.77 |
| value (naive)  | 13.04% | 0.65 | -41.93% | 0.58 | 0.71 |
| all (null)     | 12.78% | 0.91 | -22.54% | 1.06 | 0.78 |

Verdict: FAIL on the primary criterion (quality_value Sharpe 0.86 <= all 0.91),
and it does not beat `all` in IS or OOS either. What DID hold: the quality gate is
a large improvement over naive value (Sharpe 0.65->0.86, MaxDD -42%->-30%, CAGR
13%->16.8%) -- quality fixes value traps as hypothesized. What did NOT hold: it
still fails to beat simply owning the equal-weight universe on a risk-adjusted
basis. It earns +4% CAGR over the null but at enough added risk that Sharpe falls
below it; Sharpe was preregistered as primary specifically to block the
"but higher return" rescue. Cross-test lesson (Tests 001+002): a 20-name
concentrated portfolio keeps losing on Sharpe to the 500-name equal-weight null --
diversification is beating stock-selection here, a CONFOUND (concentration) that
any fair signal test must control for. Next test, if any, is a NEW preregistered
hypothesis -- e.g. hold a full quintile (~100 names) so diversification is
comparable and the signal is isolated. Not a re-tune of Test 002.

---

## Test 003 -- breadth-matched selection test  [RUN: PASS]

Result (gross, OOS Sharpe vs 100 random same-breadth portfolios):

| Breadth | qv OOS Sharpe | random median | random p90 | verdict |
|---|---|---|---|---|
| 20  | 0.97 | 0.83 | 1.00 | PASS (> median) |
| 50  | 1.05 | 0.84 | 0.93 | STRONG-PASS (> p90) |
| 100 | 1.01 | 0.85 | 0.90 | STRONG-PASS (> p90) |

Full-period qv Sharpe: 1.02 / 1.10 / 1.11. quality_value beats the random
same-size median at every breadth and clears p90 at 50 and 100 -- OOS evidence of
selection skill above chance. Reconciles Tests 001-002: their FAIL vs the 500-name
null was a CONCENTRATION confound (20 names = higher variance), not a dead signal.
Design correction was decisive.

CAVEATS (a positive result is where over-claiming is most dangerous):
- GROSS of costs. Monthly rebalance turnover is real; costs lower absolute Sharpe.
  The RELATIVE result (vs random) is robust to costs (matched turnover at equal
  breadth), but a tradeable NET edge is not yet established.
- One universe (US top-500), one period (2010-2022), one signal construction. Not
  yet shown across regimes/markets.
- Beating p90 = better than 90% of random portfolios (~p<0.10 per breadth);
  consistent across breadths strengthens it, but this is evidence, not proof.
- Test 003 tested quality_value (gated), not naive value -- cannot yet attribute
  the skill to the quality gate vs the value rank separately.

Next disciplined steps (NOT execution): (1) re-run with realistic costs to see if
the edge survives net; (2) attribute -- does naive value ALSO beat random, or is
the quality gate doing the work; (3) robustness across a different period. Each a
new preregistered test. Do NOT move to paper/live on one clean backtest.

---

## Test 006 -- attribution / risk decomposition of qv100  [RUN: TEMPERING + BUG FOUND]

- Sector: moderate tilts only -- underweight Utils -4.9%, RealEst -3.7%; overweight
  FinSvc +3.6%, Tech +2.4%. NOT a concentrated sector bet (quality avoids low-ROE
  bond-proxies, as expected).
- Size: mktcap percentile 0.55 -- essentially size-neutral. Not a size bet.
- Market: beta 0.99, corr 0.95 -- a market-beta portfolio with a small premium.
- Benchmarks: FULL qv Sharpe 1.11 > EW500 0.99 > EWtop100 0.93 (qv wins in-sample).
  **FWD2023 qv 1.13, EW500 1.09, EWtop100 1.26 -- the trivial equal-weight top-100
  by market cap BEAT qv forward.** A zero-signal big-cap portfolio outperformed the
  whole construction once the regime turned mega-cap. Strongest evidence yet that
  this is not durable selection alpha.
- BUG FOUND: fcf_yield/roe can be NaN; isinstance(nan,float) is True so the filter
  passed them, and Python sorts NaN keys arbitrarily -> the qv ranking has included
  NaN-contaminated names in arbitrary slots since Test 002. Fix: require
  math.isfinite. Unknown whether clean data strengthens or weakens the edge.

Overall read after Tests 001-006: quality_value is a SMALL, market-like (beta~1),
regime-sensitive quality/value tilt. It survived forward data in sign (Test 005)
but compressed to marginal, and a dumb EW-top-100 beat it forward (Test 006). It is
NOT a concentrated sector/size bet, but also NOT demonstrated durable alpha. Honest
provisional conclusion: not worth paper trading as stock-picking on this evidence.
Final rigor gate before concluding: fix the NaN bug and re-run the forward test
(Test 005) on clean data to confirm the marginal result is not a NaN artifact.

- Purpose: understand WHAT drives qv100 before any paper/live. Diagnostic, not a
  pass/fail test -- no tuning. The decision it informs: is the (marginal) edge real
  stock-selection, or a sector/size/beta tilt obtainable more cheaply?
- Measured (frozen qv100 rules), full period + forward 2023+:
  1. Sector exposure: qv100 average sector weights vs the EW-500 universe -> tilts.
  2. Size: average market-cap percentile of qv100 holdings within the 500 universe.
  3. Beta and correlation of qv100 monthly returns to EW-500 (market proxy).
  4. Cheaper-benchmark check: qv100 Sharpe vs EW top-100 by market cap (is qv
     better than just owning the 100 biggest?).
  5. Factor sanity: qv100 avg FCF yield and ROE vs universe (confirm construction).
- Interpretation guide: a large single-sector overweight, an extreme size tilt, or
  qv failing to beat EW-top-100 would mean the "edge" is a factor/sector bet, not
  durable selection -> not worth trading as stock-picking.
- DEFERRED to Test 007 (if this warrants it): sector-neutral random null,
  sector-neutral qv, momentum/leverage exposures, per-name contributors/detractors.

---

## Test 005 -- frozen forward-period extension  [RUN: PASS but MARGINAL]

Forward slice 2023-01 .. 2026-04 (data end), net@10bps:

| Breadth | qv Sharpe | CAGR | MaxDD | hd median | hd p90 | all EW-500 |
|---|---|---|---|---|---|---|
| 50  | 1.05 | 15.8% | -11.5% | 1.03 | 1.21 | 1.08 |
| 100 | 1.11 | 15.7% |  -9.4% | 1.04 | 1.18 | 1.08 |

Verdict: PASS (qv > hd median both breadths) but NOT strong, and materially
weaker than in-sample. Honest read:
- GOOD: the edge survived genuinely-forward data (kept its sign) -> not a pure
  stale-period artifact. Selection skill is real. Most backtested edges fail this.
- SOBERING: it compressed from top-decile (Test 004 STRONG, > p90) to barely above
  the random MEDIAN (+0.02 Sharpe at B50, +0.07 at B100). It did NOT beat the
  EW-500 null forward at B50 (1.05 < 1.08); ties at B100. The hd distribution
  itself rose to ~1.0 Sharpe (vs ~0.83) -- 2023-2026 was a benign broad rally
  (shallow -9 to -11% DD), and selection matters less when everything rises. The
  edge is REGIME-SENSITIVE.
Conclusion: a small, real, regime-sensitive tilt -- NOT the strong alpha the
in-sample STRONG-PASS implied. The forward compression is a hint of a possible
hidden/time-varying exposure. Do NOT proceed to paper/live on this.

Next (now MORE important, not less): the frozen audit -- sector exposures, top
holdings by year, factor tilts -- to learn WHETHER the faded edge is a hidden
sector/factor bet. That diagnostic, not a strategy report, is the right next step.

- Motivation: Test 004 OOS (2016-2022) is still in-period. The decisive check is
  genuinely FORWARD data the signal never touched. Catches stale-period artifacts.
  Prove it is not a period accident before any strategy report.
- FROZEN: EXACT qv50/qv100 rules, universe, gate, seeds, cost model from Test 004.
  The ONLY change is extending set_end_date to 2026-07-01. No factor or parameter
  changes whatsoever. This is a freshness/OOS extension, not tuning.
- Report: metrics on the FORWARD slice 2023-01-01 .. 2026-07 specifically (qv vs
  hold-random median/p90, vs EW-500), per breadth, net@10bps; plus per-year.
- PASS: qv Sharpe on the 2023-2026 forward slice > hold-random MEDIAN (both
  breadths), net@10bps.
- STRONG: qv > hold-random p90 on the forward slice.
- FAIL: qv <= hold-random median on the forward slice -> the edge was a
  stale-period artifact; do not proceed to a strategy report.
- Frozen: breadths {50,100}, K=100, same seeds, ROE>=median gate, top-500, monthly.
- If PASS: next is a frozen strategy audit report (exact rules, sector exposures,
  top holdings by year, drawdowns, monthly/annual returns) then paper/shadow design.
  Still NOT live.

---

## Test 004 -- cost + robustness of quality_value  [RUN: STRONG PASS]

Turnover (OOS, 1-way/mo): qv ~18-21%, hold-random 0.4%, redraw-random 80-90%. So
qv pays MORE cost than the hold-random null it beats -- conservative comparison.

| Breadth | net@10bps Sharpe | hd median | hd p90 | @50bps | verdict |
|---|---|---|---|---|---|
| 50  | 1.03 | 0.82 | 0.91 | 0.93 | STRONG at every cost 0-50bps |
| 100 | 0.98 | 0.84 | 0.90 | 0.89 | STRONG to 25bps, PASS at 50bps |

- PRIMARY PASS: qv net@10bps > hd median at both breadths (1.03>0.82, 0.98>0.84).
- STRONG PASS: qv > hd p90 @10bps and > hd median at 25 and 50bps, both breadths.
- ROBUSTNESS PASS: qv100 yearly OOS net@10bps positive EVERY year 2016-2022
  (+12.9/+25.5/+5.9/+17.8/+14.6/+28.4/+8.2%), worst +5.9%. Not one-period.
- Also beats `all` EW-500 (1.03/0.98 vs 0.86). At breadth 50/100 qv beats both nulls.

Verdict: the selection edge survives realistic costs (large-cap ~2-5bps; holds to
50bps), pays more turnover than its null and still wins, and is spread across all
7 OOS years. First credible, robust, preregistered positive result.

REMAINING CAVEATS (do NOT skip to live):
- One universe (US top-500), one period (OOS ~2016-2022). No cross-regime / other
  market / pre-2010 / post-2022 validation.
- SECTOR-NEUTRALITY UNTESTED -- the biggest open confound. The edge could be a
  sector bet (the +25%/+28% years may be sector tilts). Test 005 must check this.
- Shadow model: idealized monthly-close fills, costs via a bps proxy only (no
  slippage/impact/liquidity). Real execution differs.
- Researcher DOF across Tests 1-4 (each preregistered, which limits it).

Next gate = Test 005: sector-neutral random null / sector-exposure report. Only
after that, a clean QC strategy report and a true out-of-period test. NOT live.

- Motivation: Test 003 showed gross selection skill. Before treating quality_value
  as a candidate strategy it must survive realistic COSTS and not be a one-period
  artifact. Robustness, NOT optimization -- no factor changes.
- Breadths: 50 and 100 only (the STRONG-PASS breadths).
- Portfolios (same universe/period/dates/seeds as Test 003):
  * qv = quality_value top-N.
  * hold-random (K=100): random N-name portfolio that HOLDS, replacing only names
    that leave the universe -> low turnover, TURNOVER-MATCHED to qv. This is the
    fair null for a cost comparison (Test 003 redraw-random churns ~100%/mo and
    would be unfairly cost-penalized).
  * redraw-random (K=100): kept from Test 003 for continuity.
  * all = equal-weight ~500.
- Costs: per-side bps grid {0, 5, 10, 25, 50}; monthly cost = 2 * one_way_turnover
  * bps/1e4 (round trip). One-way turnover = names_changed / breadth.
- Report (OOS): CAGR, Sharpe, MaxDD, avg one-way turnover per portfolio at each
  cost level; plus rolling per-year qv returns (is the edge one-period?).
- PASS criteria, fixed in advance:
  1. PRIMARY: qv (both 50 and 100) OOS Sharpe NET at 10 bps > hold-random MEDIAN
     OOS Sharpe net at 10 bps.
  2. STRONG: qv > hold-random p90 at 10 bps AND qv > hold-random median at 25 AND
     50 bps.
  3. Robustness: the OOS edge is not concentrated in a single year (no one year
     carrying the whole result).
- FAIL: qv OOS Sharpe net at 10 bps <= hold-random median -> no net selection edge.
- Frozen: breadths {50,100}, K=100, fixed seeds, ROE>=median gate, top-500,
  monthly, 2010-2022.
- DEFERRED to a future preregistered test (Test 005 candidate): sector-exposure
  reporting and a SECTOR-NEUTRAL random null (Codex 3c) -- omitted here to bound
  complexity; if qv survives costs, sector-neutrality is the next confound to rule
  out (is the edge just a sector bet?).

---

## Test 003 -- breadth-matched selection test  [original preregistration, kept for the record]

- Motivation: Tests 001-002 compared a 20-name portfolio to the 500-name null, so
  concentration (a confound) may have swamped the signal. Correct question: does
  quality_value pick BETTER stocks than a RANDOM portfolio of the SAME size?
- Design: for breadths N in {20, 50, 100}, compare quality_value top-N against
  N_RANDOM=100 random N-name portfolios drawn (fixed seeds) from the SAME eligible
  universe each month. Same universe (top-500 by mktcap, price>5, fcf_yield+ROE),
  same monthly rebalance dates, same IS/OOS split, same period (2010-2022).
- Returns: gross equal-weight monthly (no costs -- pure selection test; turnover is
  matched at equal breadth so costs roughly cancel). No actual trading; shadow
  return series computed from month-over-month prices of held names.
- Report, per breadth: quality_value CAGR/Sharpe/MaxDD vs the random distribution
  (median, 10th, 90th percentile) for the same metrics, full + IS + OOS.
- PASS criteria, fixed in advance:
  1. PRIMARY: quality_value OOS Sharpe > random-null MEDIAN OOS Sharpe (at a given
     breadth) -- evidence of selection skill above chance.
  2. STRONG: quality_value OOS Sharpe > random-null 90th-percentile OOS Sharpe.
  3. FAIL: quality_value OOS Sharpe <= random median -> results are within the
     range of random same-breadth portfolios = no demonstrated selection skill.
- Frozen (not to change after results): breadths {20,50,100}, N_RANDOM=100, fixed
  seeds, ROE>=median gate, top-500 universe, monthly, 2010-2022, gross returns.
- Note: this is an experimental-design correction (isolate signal from
  concentration), NOT optimization. If quality_value fails to beat the random
  median at every breadth, the signal has no demonstrated stock-selection skill.

---

## Test 002 -- value + quality  [original preregistration, kept for the record]

- Hypothesis: the Test 001 failure mode is value traps (cheap FCF = distressed /
  cyclical / melting). Gating on QUALITY before ranking on value should cut the
  drawdown and raise Sharpe versus naive value, and ideally beat the null. This is
  the original screener philosophy (quality-gated value), tested honestly.
- Universe: unchanged (top 500 by market cap, price>5, both `fcf_yield` and ROE
  available).
- Quality gate: keep names with ROE >= the MEDIAN ROE of the eligible universe that
  month. Relative gate, no arbitrary absolute threshold = nothing to tune.
- Signal (`quality_value`): among quality-passing names, top-20 by FCF yield, equal
  weight, monthly.
- Null controls (same code, same universe/period): `value` (Test 001 arm: top-20
  FCF, no gate) and `all` (equal-weight universe).
- PASS criteria, fixed in advance:
  1. PRIMARY: `quality_value` Sharpe > `all` Sharpe (0.91) -- a real edge over
     simply holding the universe. Beating naive `value` alone is NOT sufficient.
  2. SECONDARY: `quality_value` MaxDD materially better than `value` (-42%),
     ideally approaching `all` (-23%) -- confirms the gate fixed the trap problem.
  3. Must hold in BOTH the IS and OOS halves (no single-period reliance).
- FAIL: `quality_value` Sharpe <= `all` Sharpe -> the gate may help vs naive value
  but there is still no edge over the universe; this construction is falsified.
- Frozen (must NOT change after seeing results): TOP_N=20, monthly, 2010-2022,
  universe=500, quality metric = ROE, gate = median. If Test 002 fails, the next
  test is a NEW preregistered hypothesis, not a re-tune of this one.
