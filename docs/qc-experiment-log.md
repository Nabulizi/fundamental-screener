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

## Test 004 -- cost + robustness of quality_value  [PREREGISTERED, not yet run]

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
