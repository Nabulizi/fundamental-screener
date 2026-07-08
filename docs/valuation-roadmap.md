# Valuation Roadmap

Phased plan to make the per-ticker DCF detail page more analyst-grade **without**
slowing the bulk screener or overfitting provider labels. Revised after two
review rounds (code + senior-analyst + implementation-agent critique).

Backlog issues: #9 (normalized FCF base), #10 (driver context), #11 (bear/base/bull),
#12 (financial business-model classification).

## Ground truth (verified against the repo)

- `QuoteProvider` has one method: `fetchCompany(ticker) → ScanRow`. Finnhub uses 3
  endpoints (`profile2`, `metric=all`, `quote`); all screener data comes from `metric=all`.
- The detail page (`app/[ticker]/page.tsx`) reuses the bulk `scanTickers` path — any
  valuation-only fetch must be **added separately** there, never into `scanTickers`.
- AlphaVantage failover already returns `fcfYieldPercent: null` — the valuation path
  assumes **Finnhub-only** and treats "no profile" as a first-class state.
- `lib/cache.ts` is hard-typed to `ScanRow` (`CacheEntry.row: ScanRow`) — **cannot** hold
  a `ValuationProfile`. A separate cache is required.

## Execution order & PR split

| Phase | Issue | PR | Depends on | Scoring bump? |
|---|---|---|---|---|
| 0. Provider data spike | — | no PR (probe + fixtures) | — | no |
| 1. Valuation profile plumbing + cache | #9 (foundation) | own PR | 0 | no |
| 2. Normalized FCF base selector | #9 | own PR | 1 | no |
| 3. Driver context | #10 | own PR (split per-driver if large) | 1 | no |
| 5. Financial classifier | #12 | **isolated PR** | none | **maybe 3→4** |
| 4. Bear/base/bull scenarios | #11 | own PR | 1–3, **5** | no |

Financial classification (5) lands **before** public scenario valuation (4): scenario
output must never appear for a misclassified balance-sheet financial. Phase 5 is
otherwise independent and may move earlier.

---

## Phase 0 — Provider data spike (no product change)

Decides whether Phase 1 parses the `series` block already returned by `metric=all`
(cheap) or needs a dedicated financials endpoint (heavier, possibly premium).

**Files:** `scripts/probe.mjs`.

**Verify explicitly (all of these, on the real API plan):**
- Which endpoint returns **annual cash-flow history** on the current plan
  (`/stock/metric?metric=all` `series.annual`, vs `/stock/financials?statement=cf&freq=annual`,
  vs `/stock/financials-reported`).
- Is **FCF direct**, or must it be derived as `operatingCashFlow − capex`?
- **Capex sign convention** (positive outflow vs negative).
- Availability of **revenue, SBC, diluted shares** per year, and **cash / total debt**.
- Whether the endpoint is **free, rate-limited, or premium** (403 on free tier?).

**Output:** a short findings note in the PR **plus captured JSON fixtures** from real
payloads for ≥5 tickers (AAPL, MU, HOOD, XOM, a REIT). Do not design the types before
seeing the payload.

---

## Phase 1 — Valuation profile plumbing + cache (the standalone first PR)

Land the data layer with **zero change** to the screener or the DCF UI.

**Files**
- `lib/valuation.ts` *(new)* — types + pure normalization/averaging helpers.
- `lib/valuationProvider.ts` *(new)* — Finnhub-only fetch (`series` parse or financials call per Phase 0).
- `lib/valuationCache.ts` *(new)* — a `ValuationProfile`-typed cache; **do not** reuse `lib/cache.ts` (ScanRow-typed) and **do not** genericize it — keep the screener cache simple.
- `app/[ticker]/page.tsx` — add a **second, independent** server fetch in parallel with `scanTickers`, non-blocking. Run both with **`Promise.allSettled`** so a rejected valuation fetch can never take down the page: the scorecard/metrics render from the `scanTickers` result regardless, and the profile is used only if its promise fulfilled.
- `test/valuation.test.ts` *(new)* + `test/fixtures/valuation-*.json` (from Phase 0).

**Types**
```ts
export interface ValuationYear {
  fiscalYear: number;
  fiscalPeriodEnd?: string | null;
  revenue: number | null;
  operatingIncome: number | null;
  operatingCashFlow: number | null;
  capex: number | null;              // store normalized sign; document it
  freeCashFlow: number | null;       // direct, or OCF − capex per Phase 0
  stockBasedCompensation: number | null;
  sharesDiluted: number | null;
}

export interface ValuationProfile {
  ticker: string;
  fcfTtm: number | null;             // today's basis, for continuity
  history: ValuationYear[];          // oldest → newest; may be empty/partial
  sharesOutstanding: number | null;  // latest, for per-share (Phase 4)
  netCash: number | null;            // collected but UNUSED under the equity-FCF model (see note)
  source: 'finnhub-series' | 'finnhub-financials' | null;
  retrievedAt: string;
}
```
- **`ScanRow` stays unchanged** — these fields are valuation-only and would bloat every bulk scan.
- **`netCash` is collected but deliberately UNUSED** by the DCF math under the current equity-FCF
  model: the panel discounts equity/levered FCF and compares to market cap, so no net-cash bridge
  applies (`dcf.ts` keeps `netCash = 0`). It's captured now only so a future unlevered/EV model
  (see "don't build yet") wouldn't need another provider round-trip. Do not wire it into `intrinsicDcf`.

**Provider capability (explicit)**
```ts
export interface ValuationProvider {
  readonly name: string;
  fetchValuationProfile(ticker: string, signal?: AbortSignal): Promise<ValuationProfile>;
}
// lib/buildProvider.ts (server-only): returns a Finnhub-only impl, or null when
// there is no Finnhub key (AlphaVantage has no valuation support).
export function buildValuationProvider(): ValuationProvider | null;
```
The detail route calls `buildValuationProvider()` **separately** from `buildProvider()`/`scanTickers`.

**Fallback behavior (tested)**
- Profile fetch fails / provider is null / unsupported → `ValuationProfile` is `null`; the page renders **exactly today's** TTM-only behavior; no error beyond a subtle "history unavailable."
- Partial history → keep existing years; averages compute over usable years only; label the count.
- A year with `null` FCF → excluded from averages, **never coerced to 0** (repo's missing≠zero rule).

**Tests:** fixtures for full 5-yr, partial 2-yr, all-null, provider-unsupported, negative-FCF year. Assert: null-safe averaging; correct `source`; profile-null path returns TTM-equivalent; no throw on malformed payload.

**Acceptance**
- `ScanRow`, the screener, and the DCF panel behave identically to before.
- Finnhub-served tickers fetch + cache a `ValuationProfile`; failures never break the page.
- `npm test / typecheck / lint / build` all green; fixtures cover missing + partial data.

---

## Phase 2 — Normalized FCF base selector (completes #9)

**Files:** `components/DcfPanel.tsx`, `app/[ticker]/page.tsx` (pass the profile),
`lib/valuation.ts` (pure `selectFcfBase(profile, choice)` helper). `lib/dcf.ts` unchanged.

**Availability rules (explicit — no contradiction):**
- **TTM** — available iff current FCF exists.
- **3Y avg** — available with **≥2** usable annual FCF years; label the count used.
- **5Y avg** — available with **≥3** usable annual FCF years; label the count used.
- Never coerce `null → 0`; average over usable years only.
- **Default:** TTM until ≥3 usable years exist, then default to 3Y avg with TTM shown alongside.
- **user-adjusted** — editable FCF₀ seeded from the selected base.

**Fallback:** no profile → selector hidden, TTM-only. Thin history → only the bases whose rule is met are offered.

**Tests:** `selectFcfBase` returns the right `fcf0` per choice; unavailable bases are disabled under the rules above; recompute of `impliedGrowth` off the chosen base. (Logic in the pure helper so no rendering needed.)

**Acceptance:** implied-growth changes coherently with the base; lumpy single years no longer silently drive it. **No scoring bump.**

---

## Phase 3 — Driver context (#10)

**Files:** `components/DcfPanel.tsx` or new `components/DriverStrip.tsx`; reuse the Phase-1 profile.

**UI:** neutral context strip — trailing revenue growth (already on `ScanRow`), operating-margin trend, FCF margin, capex intensity (capex/revenue), SBC as % revenue, diluted-share-count change. No colors/verdicts.

**Split recommendation:** most likely to balloon — **split per driver** if a field needs its own call/normalization (SBC and buybacks are the usual offenders). Ship revenue/margin/FCF-margin first (in profile), then capex/SBC/share-count as follow-ups.

**Fallback:** each driver renders "N/A" independently on null (never 0).

**Tests:** each driver's derivation from a fixture profile; N/A on null. **No scoring bump.**

---

## Phase 5 — Financial business-model classification (#12) — *isolated PR*

**Files:** `lib/scoring.ts` (`FINANCIAL_PATTERNS` → curated classifier) and/or new
`lib/financialClassification.ts`; `test/scoring.test.ts`.

**Approach:** **industry default + explicit per-ticker overrides** for the ambiguous names.
Gate balance-sheet/spread businesses (banks, insurers/reinsurers, brokers holding customer
assets, card lenders COF/DFS). **Don't** gate asset-light fee/data/exchange/ratings/network
businesses (BLK/TROW, CME/ICE/NDAQ/CBOE, SPGI/MCO/MSCI, V/MA).

**Signature:** the classifier must take **`(ticker, industry)`**, not `industry` alone — the
per-ticker override layer is what disambiguates same-label opposites (V/MA vs COF/DFS both
"Credit Services"). This replaces today's `isFinancialIndustry(industry)`; update both call sites
(the scorecard neutralization and the DCF gate) to pass the ticker too.

**Scoring-version:**
- Bump `SCORING_VERSION` **only if scorecard neutralization behavior actually changes** — not for
  documentation-only or DCF-gate-only changes. A curated classifier that re-gates tickers in the
  scorecard → bump 3→4 (snapshots then separate the eras). A DCF-gate-only refinement → no bump
  (but avoid — it desyncs the gate from the scorecard).

**Risks/tradeoffs:**
- **Curated maps go stale** (new listings, reclassifications, M&A) → keep an industry-level default so
  only genuinely-ambiguous tickers need an override entry.
- **Label instability** — Finnhub industry strings can change; a ticker-keyed override is more stable
  than the label but needs upkeep; document the maintenance expectation in-code.
- **Historical tier discontinuity** — reclassifying financials changes past tiers; the version bump
  keeps the snapshot record honest. Don't skip it.
- **Over-fitting** — cover the reviewer-named tickers + obvious peers; default the rest by industry.

**Tests:** gated (JPM, BAC, SCHW, HOOD, IBKR, COF, DFS, an insurer); NOT gated (BLK, TROW, CME, ICE,
NDAQ, SPGI, MCO, MSCI, V, MA); unknown label → sensible default.

---

## Phase 4 — Bear/base/bull scenarios (#11)

**Files:** `lib/dcf.ts` (scenario wrapper), `components/ScenarioPanel.tsx` *(new)*, `app/[ticker]/page.tsx`.

First phase that genuinely needs: **shares outstanding** (Phase 1) for per-share output; an explicit
**cost-of-equity** basis (keep equity FCF vs market cap — do not introduce WACC/net-debt unless also
switching to unlevered FCF; see "don't build yet"); and clear **equity-vs-enterprise** handling
(reuse the `dcf.ts` guardrails).

**Types:** `interface Scenario { label: 'bear'|'base'|'bull'; growth; margin?; terminalGrowth; discountRate }`
→ reuse `intrinsicDcf` per scenario → `{ low, base, high }` per share.

**Ordering caveat:** do **not** globally enforce `bear ≤ base ≤ bull`. That holds only for the default
preset; once users edit assumptions they can invert it. Test ordering **for the default preset only**;
otherwise render whatever the assumptions produce (optionally annotate an inverted range).

**Acceptance:** a labeled value-per-share **range**, never a single "fair value"; framed as
"Market-Implied Expectations," informational-only. **No scoring bump.**

---

## What NOT to build yet

- A full unlevered/WACC + net-debt DCF — the equity-FCF-vs-market-cap lens is sufficient and honest;
  WACC/beta/cost-of-capital invites the net-cash double-count the current docs warn against.
- A single "intrinsic value" point estimate — keep the range / reverse-DCF framing.
- Backtesting implied-growth accuracy, or multi-provider historical reconciliation.
- Persisting historical fundamentals in a DB — per-detail-fetch + in-memory cache is enough.
- Any of this as a screener column — depth-on-one; the bulk table stays lean.
- A new provider dependency for history until Phase 0 proves `metric=all` `series` is insufficient.
