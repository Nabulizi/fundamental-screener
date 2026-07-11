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

## Test 002 -- value + quality  [PREREGISTERED, not yet run]

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
