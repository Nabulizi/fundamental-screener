# Delisted-price vendor recon + one-month validation protocol

Decision-grade note for the quant research path (see `quant-research-plan.md`).
The project is at a **data-purchase/validation decision**, not an implementation
decision. Do NOT build another loader until a vendor passes the trial below.

## The acceptance test is TERMINAL RETURNS, not "has delisted tickers"

Every vendor's marketing says "survivorship-bias-free / includes delisted
securities." That is necessary but **not** sufficient. A backtest needs the
*return*, and for a dead company the single largest return is the terminal event:

- **cash merger** → stock stops, holder receives $X/share cash
- **stock merger** → holder receives N shares of the acquirer
- **cash+stock+CVR** → messy hybrid (contingent value rights can expire worthless)
- **bankruptcy** → common equity → ~0 (−100%)

Free sources (Yahoo/Stooq) give price bars up to the last trading day and drop
this leg — the most important return goes missing. **A vendor only passes if the
terminal return is recoverable.** Marketing pages cannot prove this; only a trial
pull of known-dead tickers can. Hence every terminal-return cell below that isn't
explicitly documented is marked **"must verify in trial."**

## Comparison matrix

Legend: **Yes** (documented) · **No** (documented absent) · **MV** (must verify in
trial — not clearly documented) · **Partial**. Pricing is approximate (≈2025–26),
**confirm at purchase**.

| Axis | CRSP / WRDS | Sharadar (Nasdaq Data Link) | Polygon | Norgate |
|---|---|---|---|---|
| Delisted daily prices | Yes | Yes (SEP) | Yes (`active=false`, `delisted_utc`) | Yes (Platinum/Diamond) |
| Adjusted total-return series | **Yes** (RET incl. dividends) | Yes (split/div-adjusted) | Partial (split-adj; div via separate endpoint; TR self-built) | Yes (div-adjusted / TR options) |
| **Cash merger encoded in return** | **Yes** (DLRET) | MV | **No** (not modeled as a return) | MV (designed for it) |
| **Stock merger encoded in return** | **Yes** (DLRET/acquirer link) | MV | **No** | MV |
| **Bankruptcy wipeout encoded (−100%)** | **Yes** (delisting code + DLRET) | MV | **No** (bars just stop) | MV |
| Historical constituents / PIT universe | **Yes** (S&P membership via CRSP/Compustat) | MV (not a documented core feature) | No (reconstruct from ticker snapshots) | **Yes** (index constituents to 1990) |
| PIT fundamentals | Yes (via Compustat PIT/Snapshot) | **Yes** (SF1, `datekey`, dimensions) | Partial (financials vX, `filing_date`; MV as-first-reported) | No / minimal |
| Python / macOS usability | Yes (`wrds` pkg, cloud Postgres) | **Yes** (`nasdaqdatalink`, pure API) | **Yes** (REST + official client) | **Windows-bound** (NDU desktop app req; macOS ⇒ VM/Wine) |
| Cost / trial | Institutional only; free *if* you have university access | ≈$40–50/mo bundle (verify); sample tables free | Free tier (limited, likely excludes delisted); paid ≈$29–199/mo by tier | Annual sub; **3-week free trial** |

### Per-vendor notes (the nuance the table can't hold)

- **CRSP/WRDS** — the gold standard and the *only* vendor where terminal returns
  are a documented first-class feature: `DLRET` (delisting return) explicitly
  encodes merger/liquidation/bankruptcy final value, and delisting codes classify
  the event. Purpose-built for survivorship-free research. **Only viable if you
  have university/library WRDS access** — then it's free to you and wins outright.
  No personal trial otherwise. Fundamentals come via Compustat (confirm you have
  the PIT/Snapshot product, not the restated back-file).
- **Sharadar** — best *friction* profile for a macOS/Python solo user: pure API,
  no Windows, and it bundles survivorship-free prices (SEP) with genuinely PIT
  fundamentals (SF1 keyed on `datekey` = availability date — directly solves the
  restatement problem EDGAR spike was working around). Two real unknowns: (1)
  whether the **terminal return** is recoverable (SEP prices + the ACTIONS table
  may require you to construct it — MV), (2) historical index membership is not a
  documented core feature (MV). If terminal returns pass, this is likely the pick.
- **Polygon** — best pure-API/macOS ergonomics, but **weakest on the axis that
  matters**: it models splits and dividends, not merger consideration or
  bankruptcy value, so the terminal leg is *not* encoded and would be self-built
  from external corporate-action data. Use only as a cheap API spike if Sharadar
  is unavailable. ("Massive" — unverified as a distinct vendor; do not rely on it
  without confirming it exists and is survivorship-free.)
- **Norgate** — excellent survivorship-free data and the best **historical index
  constituents** (S&P membership to 1990), and it's *designed* for survivorship-free
  backtesting — so terminal handling is plausibly good, but still MV in trial.
  **Dealbreaker for you: Windows-only** (the `norgatedata` Python package needs the
  Norgate Data Updater desktop app running). On macOS that's a Windows VM just to
  evaluate. Minimal fundamentals.

## Live check — Sharadar SEP page (2026-07)

Pulled from `data.nasdaq.com/databases/SEP` directly. Documented facts that
update the matrix:

- **Delisted coverage confirmed:** "21,000 active and delisted tickers, history
  to 1998" — survivorship-inclusive is documented, not MV.
- **Corporate actions tracked:** splits, dividends, spinoffs, **acquisitions,
  delist reasons**, ticker changes, via a dedicated `SHARADAR/ACTIONS` table.
- **Terminal return stays MV — and here's why precisely:** the documented price
  adjustment covers dividends / splits / spinoffs **only, not merger cash
  consideration.** So a cash-acquisition payout is *not* auto-encoded in the
  adjusted close; you reconstruct it from the ACTIONS acquisition row. The data
  to do so is documented to exist — but that the reconstruction yields the right
  terminal return must be proven in trial (TWTR/ATVI cash, XLNX stock, LEH →0).
- **Free sample cannot test this:** the free SEP sample is fixed tickers, window
  **2018-09-01 → 2018-12-31 only.** All five acceptance-test tickers delist
  outside that window, so the $0 path can't validate terminal returns — a
  one-month personal subscription is the minimum to run the protocol.
- **Pricing is gated behind a (free) Nasdaq Data Link account** ("Log in to view
  pricing information"). Remembered ballpark ≈ $25–50/mo personal for SEP —
  confirm after sign-in. SF1 (fundamentals) is a separate table/price.

## QuantConnect (LEAN Cloud) — evaluate FIRST if no CRSP (free)

A different shape of option: not a data feed you buy, but a **free cloud
backtester with survivorship-free US data bundled in** — delisting events,
corporate actions, ticker map-files, and Morningstar fundamentals with file
dates. It could dissolve the "buy data to get honest prices" problem entirely.

- **Pros:** free tier runs real backtests on survivorship-free data; delistings,
  splits, dividends, `SymbolChangedEvent` are first-class; fundamentals include
  file/period dates. Attacks all four blockers at $0.
- **Cons / must-verify:** (1) **data lock-in** — you can't export QC's raw
  prices/fundamentals, only backtest *results*, so the strategy lives in LEAN and
  the local harness becomes a reference tool; (2) **terminal-return fidelity is
  still the acceptance test** — QC liquidates at delisting, but stock mergers
  (XLNX→AMD) likely cash out at last price rather than delivering acquirer shares
  — MV; (3) free-tier compute/length limits — MV.
- **Spike:** `should-i-trade/quantconnect_terminal_spike.py` — paste into a QC
  Cloud algorithm, run, read the DELISTING/FILL logs against the terminal-return
  ground truth. Same pass/fail gate as the Sharadar protocol, but free.

### Spike result (2026-07): PASS — free tier, ran in ~23s

Terminal returns captured correctly on all five, including the cases free data
cannot do:

| Ticker | Event | Ground truth | QC liquidation | Verdict |
|---|---|---|---|---|
| LEH | bankruptcy | ~$0 (−100%) | $62.47 → **$0.14** | PASS (wipeout real, not a stopped series) |
| TWTR | cash merger | $54.20 | $53.78 | PASS (~0.8% pre-close discount) |
| ATVI | cash merger | $95.00 | $94.42 | PASS |
| XLNX | stock merger 1.7234×AMD | ~$194.7 | $194.87 | PASS (deal value via last price) |
| CELG | cash+stock+CVR | last ~$108 | $108.24 | PASS (CVR not modeled; expired worthless) |

Also working: splits, dividends, `SymbolChangedEvent` (ATVI→ATVID→ATVI),
map-file identity, and **fundamentals for a delisted name** (XLNX: 330 snapshots)
with `file_date` exposed. Open item: as-first-reported period↔file_date alignment
needs a cleaner probe (the spike's crude logging misaligned the multi-period blob).

**Implication:** QuantConnect resolves the delisted-price/terminal-return blocker
**for free** — the thing we were about to buy Sharadar for. The price/return leg is
a decisive pass; the fundamentals leg is a strong pass pending the alignment check.
The remaining cost is **not dollars but lock-in**: the strategy must live in LEAN
and QC's raw data can't be exported. Buying a vendor (Sharadar/Norgate) is now only
needed if you require exportable, self-owned data.

## Recommended evaluation order

1. **Check CRSP/WRDS access first.** Any current/alumni university or library
   affiliation? If yes → use it, it's free to you, the gold standard, *and*
   exportable (own the data, keep your harness). Stop here.
2. **If no CRSP → QuantConnect free spike.** Run `quantconnect_terminal_spike.py`
   in QC Cloud. If terminal returns pass, you have a free survivorship-free
   research engine (accepting LEAN lock-in). Costs nothing to find out.
3. **If QC fails or lock-in is unacceptable → Sharadar.** Verify *current* pricing
   on Nasdaq Data Link, one paid month, run the trial protocol. Owns exportable
   data, macOS-native, both legs. (Free sample can't test terminal returns —
   window is 2018 Q4 only.)
4. **Polygon** only as a cheap API spike if Sharadar is unavailable — you'll
   likely have to build the terminal-return leg yourself.
5. **Norgate** only if a Windows VM is acceptable friction (best constituent
   history, for index-membership work later).

## One-month validation protocol

Goal: spend ≤ one month and ≤ one subscription to answer a single yes/no —
**"can this vendor give me an honest total return, including the terminal event,
for dead companies?"** Not "does it have the tickers."

1. **Access** — get the trial/first-month + a Python key for exactly ONE vendor
   (per the order above). No parallel subscriptions.
2. **Resolve** — pull the 5 test tickers by the vendor's *permanent* identifier
   (CRSP permno / Sharadar ticker+permaticker / Polygon ticker+`delisted_utc` /
   Norgate symbol). Confirm each resolves and is flagged delisted.
3. **Series** — pull the full adjusted daily series for each. Confirm the final
   bar sits at/near the real delisting date (below), not years early.
4. **Terminal-return acceptance test** — for each ticker, compute the total return
   of holding from ~1 month before the event through settlement, and check it
   against the known ground truth. **This is the pass/fail gate.**
5. **Universe check (secondary)** — ask the vendor for S&P 500 membership as of
   2015-06-30 and confirm it includes names since removed. (CRSP/Norgate: expected
   Yes; Sharadar/Polygon: MV.)
6. **Fundamentals check (secondary)** — pull FY2018 revenue for AAPL and confirm
   it's keyed to the *filing/availability* date, not restated (CRSP-Compustat PIT /
   Sharadar SF1 `datekey`).
7. **Decide** — vendor passes only if step 4 passes for the cash, stock, and
   bankruptcy cases. If it fails, cancel before renewal and try the next in order.
   If none pass affordably → document that an honest survivorship-free backtest is
   not economically feasible at this budget, and stop (the Finnhub v0 plumbing
   harness remains the ceiling).

## Terminal-return trial checklist (ground truth)

Hold the checker to the *right answer* — a vendor that returns a clean price series
but the wrong terminal return fails.

| Ticker | Event & date | Consideration | Correct terminal return | Pass criterion |
|---|---|---|---|---|
| **TWTR** | Cash merger (Musk), closed 2022-10-27 | $54.20/share cash | Converges to $54.20 then cash settlement | Final return reflects $54.20 cash-out, not a series that just stops |
| **ATVI** | Cash merger (Microsoft), closed 2023-10-13 | $95.00/share cash | Converges to $95.00 cash | Terminal ≈ hold-to-$95 cash |
| **XLNX** | **Stock** merger (AMD), closed 2022-02-14 | 1.7234 AMD shares per XLNX | Value of 1.7234 × AMD price at close (then tracks AMD, or clean exit value) | Terminal return = acquirer-share value, NOT "stopped trading" |
| **CELG** | Cash+stock+**CVR** merger (BMY), closed 2019-11-20 | $50.00 cash + 1 BMY share + 1 CVR | $50 + BMY share value + CVR (CVR later expired worthless 2021) | Stress case: how is the hybrid/CVR handled? Document, don't assume |
| **LEH / LEHMQ** | **Bankruptcy**, filed 2008-09-15 | Common equity wiped out | ≈ −100% | Terminal ≈ −100%, not a truncated series near the pre-collapse price |

Coverage: cash merger (TWTR, ATVI), stock merger (XLNX), cash+stock+CVR (CELG),
bankruptcy wipeout (LEH). A vendor that encodes all four correctly is survivorship-
free *in returns*, which is the actual requirement. Anything less is a price
archive with the most important returns missing.
