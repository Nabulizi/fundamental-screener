# Fundamental Screener: honest project review and implementation roadmap

**Review date:** July 11, 2026 (America/New_York)  
**Repository reviewed:** `Nabulizi/fundamental-screener`  
**Code baseline:** local branch `feat/pit-v0-fundamental-backtest` at `a4b254d`; application code matches `main` at `495c219`, with 19 additional research/documentation commits  
**Intended reader:** product owner and future implementation agents

## Executive summary

The project is a strong engineering MVP with a better epistemic culture than its product surface suggests. It has clean provider boundaries, careful null handling, per-ticker failure isolation, thoughtful valuation guardrails, extensive unit tests, transparent experiment logs, and a research process willing to falsify its own signals. Those are rare and valuable strengths.

The main problem is not missing features. It is a **trust contract mismatch**:

- The UI presents an authoritative, traffic-light scoring system while the repository's own research says the tested quality/value family is not a live trading candidate and the full 12-criterion scorecard is not validated.
- The home-page methodology is factually out of sync with the implementation: it says 10 criteria and 0–17/0–16 ranges, while the code uses 12 criteria and 0–21/0–20.
- “Fresh” means recently fetched, not economically fresh; source filing/as-of dates are mostly unavailable.
- The public scan endpoint can spend third-party quota without user-level rate limits.
- The dense table is useful on desktop but weak on mobile and does not expose the most important distinctions—Strength, Risk, coverage, and methodology status—as separate decision inputs.

**Product recommendation:** position the application as a **research-triage and valuation notebook**, not a stock-rating engine. Make provenance, uncertainty, model status, and falsification results first-class. Do not add more signals until the current information architecture and trust contract are repaired.

**Immediate release posture:** do not market or label the composite as predictive. Keep it informational and explicitly mark the scorecard as an unvalidated heuristic. Fix P0 truth/security issues before adding another financial factor.

## P0 implementation status (July 12, 2026)

Implemented in the current working tree:

- P0-A: reader-facing methodology is generated from scoring constants and covered by a contract test.
- P0-B: experimental/unvalidated status is visible; unsupported authority/predictive wording was removed from the main methodology surface; detail labels are more neutral.
- P0-C: Strength, Risk, and Data Coverage are separate sortable columns; CSV exports include score evidence and scoring version.
- P0-D: scan request bodies are bounded, responses are `no-store`, and in-process scan/refresh budgets return `429` with `Retry-After`.
- P0-E (complete): security headers, Node/npm runtime pinning, `.nvmrc`, and TLS-safe environment guidance were added. The dependency upgrade pass landed: Next 14.2 → 16.2.10 (React 18 retained — Next 16 still supports it), `postcss` forced to ≥ 8.5.10 via an npm override (Next pins a vulnerable version internally), ESLint 8 → 9 with a flat config (`eslint.config.mjs`; Next 16 removed `next lint`, the lint script now invokes `eslint .` directly). `npm audit --omit=dev` reports **0 vulnerabilities**. The only migration code change was the async `params` signature in `app/[ticker]/page.tsx`. A contract test (`test/securityHeaders.test.ts`) pins the security headers; they were also verified live against the built server. Remaining known dev-only advisory: `esbuild <=0.24.2` (moderate, dev-server-only SSRF, via the vitest 2.x chain) — fixing it means a vitest major upgrade, deferred. Two new react-hooks v6 lint rules (`purity`, `set-state-in-effect`) flag five pre-existing patterns and are downgraded to warnings pending a separate refactor.

Production rate limiting (July 12, 2026): `lib/requestGuard.ts` now exposes a pluggable `ScanRateLimiter` interface. The route consumes budgets via `takeScanBudget`, which delegates to a limiter registered with `setScanRateLimiter` (intended call site: `instrumentation.ts`) and falls back to the in-process bucket when the shared backend errors — bounded degradation, never unlimited. API-level tests (`test/scanRoute.test.ts`) prove 413/400 body rejection and 429 + `Retry-After` at the route boundary, plus shared-limiter delegation. Deployment requirements are documented in the README ("Request limits"). Still intentionally deferred: shipping a concrete Redis/Upstash adapter (would add a dependency this repo doesn't need until a multi-instance deployment exists).

## Review scope and evidence

### Inspected

- Repository architecture, all primary app routes, provider adapters, scoring, DCF, provenance, persistence, filters, share/export, peer comparison, and major components.
- README, design notes, valuation/sector roadmaps, point-in-time research plan, experiment log, and research summary.
- Git history and repository metadata.
- Local production build and local HTTP behavior for `/`, `/api/scan`, invalid/duplicate inputs, and `/AAPL`.
- Test, typecheck, lint, build, production dependency audit, secret patterns, ignored files, and deployment-facing API controls.
- Source-level accessibility and responsive behavior.

### Verification results

| Check | Result | Interpretation |
|---|---:|---|
| `npm run typecheck` | Pass | Type system is clean. |
| `npm run lint` | Pass | No lint warnings/errors. |
| `npm run build` | Pass | Next production build succeeds. |
| `npm test` | 404/415 tests pass; 11 fail locally | Four SQLite failures are a native ABI mismatch; seven component failures are caused by Node 26's unavailable experimental `localStorage`. CI pins Node 20, but the local runtime is not reproducible. |
| Local `/` | HTTP 200 | Base route serves. |
| Local `/api/scan` with AAPL | HTTP 200, all normalized fields present | Primary live flow works with the configured provider. |
| Invalid + duplicate input | Correctly reports invalid ticker and removes duplicate | Input normalization works. |
| Local `/AAPL` | HTTP 200; detail, DCF, scenarios, sources present | Main research path renders server-side. |
| `npm audit --omit=dev` | 1 high, 1 moderate production dependency finding | Current Next/PostCSS chain has known advisories; audit proposes a breaking Next upgrade. |

### Limitations

- The in-app browser was unavailable, so this review does **not** claim hands-on visual, mobile, assistive-technology, or cross-browser validation. Those are release gates in the roadmap.
- Live checks used AAPL and input-error cases, not a statistically representative security universe.
- No private deployment configuration, analytics, user interviews, or production logs were available.
- Legal/compliance comments are risk-design guidance, not legal advice.

## What is already good and should be preserved

1. **Honest missing-data semantics.** `null` remains distinct from zero, sorting pushes unavailable data last, and formatting is consistent.
2. **Provider isolation.** `QuoteProvider`, normalized `ScanRow`, failover composition, retry behavior, and per-ticker error isolation are well separated.
3. **Server-only secret boundary.** Provider assembly uses `server-only`, and API keys are absent from tracked files.
4. **Valuation basis discipline.** The code correctly keeps equity/levered FCF with cost of equity and market cap, avoiding a WACC/net-debt basis mix.
5. **Failure-aware valuation.** Financials are gated, positive FCF is required, missing history degrades safely, and DCF assumptions have explicit mathematical guards.
6. **Methodology versioning.** `SCORING_VERSION`, snapshots, and cross-era delta suppression are the correct primitives for reproducibility.
7. **Research integrity.** The experiment log preregisters tests, uses null controls, records negative results, finds implementation bugs, and retracts invalid synthetic results after an attrition audit.
8. **Testable pure logic.** Scoring, DCF, parsing, caching, retry, filters, share state, snapshots, and data-quality flags are heavily unit tested.
9. **Useful depth-on-one workflow.** Reverse DCF, normalized FCF bases, driver history, saved cases, change tracking, peer snapshots, and provenance form a credible research notebook foundation.
10. **Restraint where data is inadequate.** `docs/sector-coverage.md` correctly refuses to fabricate bank, insurer, and REIT metrics from ambiguous inputs.

## Priority findings

Severity describes potential user/decision harm, not code style. Confidence is based on direct evidence in the repository or running behavior.

| ID | Finding | Perspective | Severity | Confidence | Why it matters |
|---|---|---|---:|---:|---|
| P0-01 | Methodology copy contradicts the implemented model | Credibility / function | Critical | High | Users cannot audit what the displayed score means. |
| P0-02 | UI implies predictive authority that the research does not support | Credibility / psychology | Critical | High | Traffic-light tiers and strong language can create automation and authority bias. |
| P0-03 | “Score” sorts only by Strength, ignoring Risk, disqualification, coverage, and tier | Function / usability | Critical | High | A dangerous high-strength row can sort above a safer row under a label users read as composite. |
| P0-04 | Public scan/refresh paths have no per-user quota protection | Security / reliability | High | High | Anonymous requests can exhaust Finnhub/Alpha Vantage quota or cause denial of service/cost. |
| P0-05 | Production dependency audit reports known high/moderate issues | Security | High | High | Internet-facing deployment carries avoidable known risk. |
| P0-06 | Local config disables TLS verification | Security / credibility | High | High | `NODE_TLS_REJECT_UNAUTHORIZED=0` weakens all Node HTTPS verification in the process. |
| P1-01 | “Fresh” describes retrieval time, not source-data economic freshness | Credibility | High | High | TTM, annual, estimates, quotes, and 52-week metrics can have different real as-of dates. |
| P1-02 | Score-driving data is not independently reconciled | Data quality | High | High | Current cross-check covers only cap, price, P/E, and yield—not FCF, growth, leverage, or margins. |
| P1-03 | Market-cap sorting/comparison is numerically cross-currency | Function | High | High | Raw EUR/JPY/USD market caps are not comparable without FX normalization or a same-currency guard. |
| P1-04 | Full 12-criterion scorecard has no decision-grade validation | Scientific credibility | High | High | The tested quality/value family was falsified; that neither validates nor fully falsifies this scorecard. |
| P1-05 | Filters are advertised and tested but removed from the UI | Usability / product | Medium | High | The app calls itself a screener but currently behaves primarily as a watchlist comparator. |
| P1-06 | Scan cannot be cancelled and does not show partial rows | Usability | Medium | High | `AbortController` exists, but Clear is disabled during load and results appear only after all requests finish. |
| P1-07 | Desktop table does not translate into a good mobile decision view | Usability / accessibility | Medium | Medium | A fixed 1,100px table depends on horizontal scrolling; mobile interaction was not browser-verified. |
| P1-08 | Peer medians can mix incomparable companies, currencies, and business models | Function / credibility | Medium | High | User-chosen peers are flexible but can create meaningless “median” anchors. |
| P1-09 | DCF presents precision without enough uncertainty decomposition | Credibility / psychology | Medium | High | Constant FCF growth, arbitrary default discount rate, terminal concentration, and annual diluted shares need clearer sensitivity. |
| P1-10 | Runtime/toolchain is not pinned tightly enough for reproducible local testing | Engineering | Medium | High | Node 26 breaks native SQLite and jsdom/localStorage tests while CI uses Node 20. |
| P1-11 | Snapshot durability and calendar semantics are deployment-sensitive | Reliability / science | Medium | High | Local JSONL/SQLite is not durable on many serverless hosts; “local day” changes by host timezone. |
| P2-01 | CNN Fear & Greed is weakly related to a fundamental-screening task | Product / psychology | Medium | High | Salient red/green sentiment can prime decisions without being part of a validated model. |
| P2-02 | CSV omits score, risk, coverage, source, and methodology version | Function / auditability | Medium | High | Exported evidence cannot reproduce the decision surface or its provenance. |
| P2-03 | No end-to-end, accessibility, or visual regression suite | Engineering / usability | Medium | High | Unit strength does not cover the integrated user journey or responsive regressions. |

## Detailed findings and fixes

### P0-01 — Make the methodology a generated, versioned contract

**Evidence**

- `app/page.tsx:391-396` says 10 criteria and Strength 0–17/Risk 0–16.
- `lib/scoring.ts` defines 12 keys, `MAX_STRENGTH = 21`, and `MAX_RISK = 20`.
- `app/page.tsx:445-472` still documents the old ten reads and old maximums.
- The page omits newer revenue-acceleration and margin-inflection reads.
- Some old descriptions do not match current logic: earnings quality now uses an FCF/net-income conversion ratio with soft/critical bands, and cyclical compression is asymmetric rather than always neutral.

**Fix**

- Build a single exported `SCORING_METHODOLOGY` object containing version, label, description, inputs, applicability, positive/negative thresholds, weight, maximums, caps, floors, and evidence status.
- Compute the displayed methodology, benchmark table, tooltips, CSV metadata, and test fixtures from that object.
- Add a contract test that renders the methodology and asserts criterion count, maximum scores, every criterion key, and current `SCORING_VERSION`.
- Add a methodology changelog keyed by version; old snapshots link to the version that produced them.

**Acceptance**

- No hard-coded “10,” “17,” or “16” remains in user-facing score copy.
- The 12 rendered criteria exactly equal `CRITERION_KEYS`.
- A scoring-version change fails CI unless a changelog entry and snapshot migration note exist.

### P0-02 — Replace authority cues with an evidence-status design

**Evidence**

- The page calls the framework “an elite analyst's composite scoring framework.”
- It calls a tier “Strong,” uses green/yellow/red, describes criteria as “strongly predictive,” calls earnings quality “your fraud filter,” and uses “fake earnings,” “fatal debt,” “permanent loss,” and “disqualified.”
- `docs/research-summary.md` concludes that the tested quality/value family is falsified as a live candidate; later synthetic results were also invalidated by attrition bias.
- The full live scorecard has not been tested as implemented across all 12 point-in-time inputs.

**Psychological risk**

- **Authority bias:** “elite analyst” substitutes prestige for evidence.
- **Automation bias:** a single colored tier encourages users to defer to the system.
- **Anchoring:** a prominent score frames all later analysis.
- **Affect heuristic:** green/red and “fatal/fraud” create emotion stronger than the data warrants.
- **Precision bias:** exact points and DCF outputs look calibrated even when thresholds are heuristic.

**Fix**

- Put an always-visible badge near the score: `Experimental heuristic · not validated for returns · methodology v4`.
- Rename the output from `Score` to separate `Strength`, `Risk`, and `Data coverage` columns. Consider removing the single tier until validated.
- If a summary label remains, use neutral research workflow labels such as `More evidence to review`, `Mixed evidence`, and `Insufficient data / material flags`; test the wording with users.
- Replace green/red row fills with neutral styling; reserve warning color for explicit data-quality or mathematical invalidity.
- Remove “elite,” “predictive,” “fraud,” “fatal,” “disqualified,” and similar causal/certainty claims. Use mechanical descriptions: `cash conversion below threshold`, `interest coverage below threshold`, `tier floored by rule`.
- Add a visible `Evidence` page that says which hypotheses were tested, falsified, invalidated, or not yet tested.
- Do not bury this status in a disclaimer. A disclaimer cannot undo the primary visual message.

**Acceptance**

- A first-time user can answer: “What is measured?”, “What is missing?”, “What has been validated?”, and “What must I independently verify?” without opening repository docs.
- No UI string claims predictive power unless a frozen validation artifact supports that exact model/version/universe/outcome.

### P0-03 — Stop sorting a composite-looking column by Strength alone

**Evidence**

- `app/page.tsx` builds `scoreMap` from `scoreRow(row).strengthScore`.
- `lib/sort.ts:53-54` uses that map for the `score` sort.
- `ResultsTable` labels the column `Score`, while tier, risk, coverage, and disqualification affect the actual interpretation.

**Fix**

- Replace `Score` with sortable `Strength`, `Risk`, and `Coverage` columns.
- Default sort should be explicit and honest, for example: coverage descending, material flags last/first by user choice, then Strength descending and Risk ascending. Do not hide this in one undocumented number.
- Add a `Research priority` preset only if its lexicographic rules are shown to the user and tested.
- Provide stable tie-breakers (`ticker`) so shared/exported results reproduce order.

**Acceptance**

- A disqualified or insufficient-data row cannot appear at the top merely because Strength is high without an obvious explanation.
- CSV order can be reproduced from exported sort metadata.

### P0-04 — Protect provider quota and availability

**Evidence**

- `/api/scan` accepts anonymous POST requests and `refresh: true`.
- It caps tickers per request but has no per-IP/user token bucket, global concurrency budget, provider spend budget, request-body byte limit, or refresh cooldown.
- Each primary ticker can cause multiple provider calls; detail pages can add history and secondary-provider calls.
- The client sends one request per ticker, making endpoint-level request count higher.

**Fix**

- Add deployment-level and application-level rate limiting keyed by authenticated user or a privacy-aware IP/session key.
- Use separate budgets for scan, refresh, peer comparison, detail valuation, and second-source checks.
- Add in-flight request coalescing by provider+ticker+data-kind and a shared persistent cache for production.
- Enforce request byte limits and a strict JSON schema.
- Make refresh server-authorized with a cooldown; return `429` plus `Retry-After`.
- Add provider-level concurrency/rate budgets and circuit breakers, not only per-ticker failure state.
- Add quota metrics and alerts: calls by endpoint/provider/status, cache hit rate, 429 rate, refresh rate, and estimated quota remaining.

This aligns with [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/).

### P0-05/P0-06 — Repair the dependency and TLS posture

**Evidence**

- `npm audit --omit=dev` reports one high-severity Next chain and one moderate PostCSS finding.
- The proposed automatic fix upgrades to Next 16.2.10 and is breaking; it should not be applied blindly.
- `.env.local` sets `NODE_TLS_REJECT_UNAUTHORIZED=0`; the dev process warns that HTTPS certificate verification is disabled.

**Fix**

- Create a dedicated Next 16 upgrade branch; use the official migration path, update React/ESLint/TypeScript as required, and run the complete suite plus E2E.
- Until upgraded, document the affected deployment paths and disable unused image optimization/rewrites/features where that materially reduces exposure.
- Add Dependabot/Renovate, CodeQL, secret scanning, and a production-dependency audit gate.
- Remove `NODE_TLS_REJECT_UNAUTHORIZED=0`. Install or point Node at the correct corporate/local CA using `NODE_EXTRA_CA_CERTS`; never disable verification process-wide.
- Add explicit security headers: CSP appropriate to Next, `frame-ancestors`, `nosniff`, a conservative referrer policy, and a permissions policy. Validate them in integration tests.

### P1-01/P1-02 — Treat provenance and data quality as part of every metric

> **Implementation status (July 12, 2026):** P1-A/B/C landed as `lib/observations.ts` — an adjacent per-field metadata map (`MetricObservation`: value, source, provider source-field, retrieval time, effectiveAt, period basis, unit, currency, reported/provider-computed/app-computed, quality flags) derived from the probe-verified field map rather than a wrapping migration of `ScanRow`. `effectiveAt` is honestly `null` for every field: neither provider reports filing dates, estimate vintages, or quote times, and the UI copy now says so instead of implying currency. Validators cover the score-driving fields (revenue growth via the scoring sanity bounds, distorted D/E, nonsense yields/multiples/caps) plus `single-source` and `secondary-disagrees` (merged from the detail-page cross-check). UI: the detail page's "Data & sources" panel renders per-field basis + flags and a fetched-vs-economically-current explanation; the scan table says "Fetched", header tooltips state each column's period basis, and freshness badges/legend describe retrieval only. Tests: `test/observations.test.ts`. Not yet done from the fuller wishlist below: provider schema/transformation version stamps, distribution-drift metrics, and an operator dashboard.

**Evidence**

- `retrievedAt` is the application's fetch time.
- Fundamentals, forward estimates, quotes, annual reports, and 52-week metrics update on different schedules.
- The detail cross-check covers only four overlapping surface fields.
- Score-driving fields are row-level rather than field-level provenance.

**Fix: data contract v2**

Represent every metric as a value plus metadata, or maintain an adjacent metadata map:

```ts
interface MetricObservation<T> {
  value: T | null;
  source: 'finnhub' | 'alphavantage' | 'sec' | null;
  sourceField: string | null;
  retrievedAt: string;
  effectiveAt: string | null;   // quote time, period end, filing date, estimate date
  period: 'instant' | 'quarter' | 'ttm' | 'annual' | 'forward' | null;
  currency: string | null;
  unit: string | null;
  reportedOrComputed: 'reported' | 'provider-computed' | 'app-computed';
  qualityFlags: string[];
}
```

- Change badges from `Fresh/Cached/Stale` to precise text: `Fetched 2m ago`; separately show `Quote as of…`, `TTM period…`, `Latest filing…`, and `Estimate vintage unknown`.
- Store provider response/schema version and transformation version.
- Reconcile the fields that drive high-weight criteria. A second source that cannot supply those fields is not a validation of the score.
- Where independent reconciliation is impossible, label the field `single-source` and lower model confidence rather than silently treating it as trusted.
- Add stable automated tests for completeness, validity, units, cross-field consistency, freshness, and distribution drift by provider/sector.
- Add an operator dashboard for null rate, suspect-value rate, cross-source disagreement, provider mix, and field freshness.

### P1-03/P1-08 — Enforce comparability before ranking or peer aggregation

> **Implementation status (July 12, 2026):** P1-D landed with the conservative (no-FX) scope from the decision log. `lib/comparability.ts` detects mixed/unknown currencies (`mixedCurrency` treats an unknown currency alongside a known one as incomparable) and produces neutral peer warnings (currency + industry alignment). `buildPeerComparison` now suppresses the market-cap median whenever the selected company + peers span mixed/unknown currencies (`medians.mixedCurrency`, rendered as "n.m. (mixed ccy)" with an explanatory tooltip) and reports per-metric observation counts (`medians.counts`, surfaced as tooltips). Ratio/percentage medians stay, because they are currency-independent. The scan table shows a visible-but-not-alarmist note when rows span currencies, with an extra clause when the active sort is market cap (sorting is warned, not blocked — a blocked sort would hide data; the warning names the exact problem). Tests: `test/comparability.test.ts`. FX normalization remains future work and requires an FX source with provenance.

**Evidence**

- Market cap is stored in raw local-currency units and sorted numerically.
- Peer comparison accepts arbitrary user-chosen tickers and computes medians without checking currency, industry, fiscal-period alignment, or business model.

**Fix**

- Choose one explicit product scope:
  1. US/USD securities only for v1, with a clear exclusion; or
  2. daily FX normalization to a selected base currency, storing FX source and as-of date.
- Never aggregate monetary values across currencies without normalization.
- For peer medians, require same currency or normalize, display the observation count per metric, and warn on mixed fiscal periods.
- Add comparability facets: sector/industry, business model, geography, size band, profitability status, fiscal year-end, and data coverage.
- Keep manual peer selection but visually separate `User selected` from an eventual `Suggested comparable set`.
- Do not auto-suggest official peers until the classification and data source are validated.

### P1-04 — Validate separate claims, not one vague “score works” claim

The scorecard combines at least four different hypotheses:

1. **Fundamental quality:** positive inputs describe a healthier business.
2. **Risk detection:** negative inputs forecast downside, distress, or drawdown.
3. **Cross-sectional return selection:** higher Strength/lower Risk predicts future excess return.
4. **Research prioritization:** the model helps a human find useful cases faster, even if it does not predict returns.

These require different outcomes and tests. Do not use a return backtest to validate usability, or a clean UI to validate return prediction.

**Scientific validation program**

1. Freeze `SCORING_VERSION`, eligible universe, rebalance schedule, horizons, costs, benchmark family, exclusions, and pass/fail criteria before results.
2. Use survivorship-free membership, terminal returns, point-in-time fundamentals, and realistic availability lags for **every** live criterion. If all 12 inputs cannot be reconstructed, test a separately named reduced model; do not imply it validates v4.
3. Separate endpoints:
   - future 3/6/12-month excess return and rank IC;
   - maximum drawdown/downside semivariance;
   - distress/delisting/earnings deterioration;
   - turnover and capacity;
   - human task time/error for research triage.
4. Require same-breadth random portfolios, equal-weight universe, cap-weight benchmark, size/sector-neutral controls, and trivial large-cap controls.
5. Report factor exposures, sector/currency concentrations, beta, and return attribution.
6. Use a truly forward holdout after the model is frozen. Do not reuse 2023–2026 after it has influenced design.
7. Correct for research multiplicity. Track every attempted family and report a deflated Sharpe or probability-of-backtest-overfitting analysis where appropriate. See Bailey et al., [The Probability of Backtest Overfitting](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253).
8. Report uncertainty intervals and economic significance, not only point estimates and pass/fail labels.
9. Run adversarial audits for NaN/non-finite inputs, missing holding returns, delistings, universe exits, stale estimates, restatements, and corporate actions.
10. Publish a machine-readable verdict: `untested`, `inconclusive`, `falsified`, `invalidated`, or `supported within scope`. The app reads this status directly.

**Current honest status**

- Research engine and process: supported by strong internal evidence.
- Naive FCF-yield signal: falsified.
- Tested quality/value family: closed as a live candidate; later synthetic metrics invalidated by attrition bias.
- Full 12-criterion application scorecard v4: untested as a complete point-in-time return model.
- DCF: deterministic scenario calculator, not a forecast and not empirically calibrated.

### P1-05/P1-06/P1-07 — Redesign the core user journey

**Product job to optimize:** “Given a watchlist, help me find which companies deserve deeper research and show exactly why—without pretending to decide for me.”

**Recommended information architecture**

1. **Watchlist scan** — input, saved lists, status, filters, results.
2. **Company research** — financial history, risk/strength evidence, valuation assumptions, peers, changes.
3. **Methodology & evidence** — versioned rules, data contract, validation status, experiment record.

**Home-screen changes**

- Show progressive rows as each ticker completes.
- Replace disabled Clear with an enabled `Cancel scan` while loading.
- Add `Retry failed` and per-row retry.
- Restore a small set of high-value filters: data coverage, material flags, sector, Strength range, Risk range, and source. Either restore the documented feature or remove dead filter/share code and README claims.
- Add column presets: `Triage`, `Fundamentals`, `Valuation`, `Income`, `Data quality`; allow a custom column chooser.
- On mobile, use stacked company cards for the Triage preset; keep the full table as an opt-in comparison view.
- Freeze/stick the identity column in horizontal table mode and announce the scroll region.
- Keep a compact, visible legend for period/unit/source.
- Preserve user's sort/filter/column state in the share URL with a schema version.
- Consider auto-scan on a shared link only after an explicit user action, to avoid spending quota unexpectedly.

**Accessibility gates**

- Meet WCAG 2.2 AA for focus order/visibility, labels, names/roles/values, status messages, reflow where applicable, contrast, and minimum target size. Reference: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- Ensure expandable score cells are real buttons with `aria-expanded`/`aria-controls`, not interactive `td` elements.
- Give the peer input a visible label and expose loading/error state through a live region.
- Test keyboard-only, VoiceOver/NVDA, 200% zoom, reduced motion, narrow portrait, and high contrast.

### P1-09 — Make valuation uncertainty more honest and useful

The DCF math is internally consistent, but its inputs are not sufficiently decomposed for the precision of the output.

**Fix**

- Display terminal value as a percentage of total present value; warn when it dominates.
- Add a two-way sensitivity table for cost of equity × terminal growth. Prefer this deterministic transparency over probabilistic Monte Carlo until distributions are defensibly calibrated.
- Show value on both total-equity and per-share bases; label annual diluted weighted-average shares as such and suppress per-share output when it is too stale or materially inconsistent with a current share source.
- Reconcile TTM FCF implied by `marketCap × FCF yield` with reported/derived annual FCF; surface the gap and basis.
- Replace a single constant FCF-growth story with an optional operating bridge: revenue growth, FCF margin path, share-count path. Keep the simple model available and name it clearly.
- Make default discount rate an explicit generic assumption, not a company estimate. If a company-specific rate is added, show its components and source.
- Add plausibility flags for growth above addressable-market/company-scale constraints, terminal growth above long-run nominal economic anchors, and extreme valuation duration.
- Do not use scenario color to imply probability. Bear/base/bull are assumptions, not calibrated likelihoods.

### P1-10/P1-11 — Make the system reproducible and deployment-aware

**Fix**

- Add `.nvmrc` or `.tool-versions`, `package.json#engines`, and CI/runtime parity. Prefer a supported LTS version.
- Reinstall/rebuild native dependencies under the pinned runtime; add a clean-clone setup test.
- Define a production persistence adapter. Local SQLite/JSONL is valid for self-hosting but not durable across most serverless instances.
- Use UTC or explicit exchange calendar date for snapshot keys; persist timezone/calendar version.
- Add snapshot schema validation, checksums or append-audit metadata, backup/restore tests, and retention/privacy documentation.
- Do not silently disable the only production history store. Expose an operator health state while keeping user scans available.

### P2-01/P2-02/P2-03 — Remove noise and complete auditability

- Remove Fear & Greed from the default fundamental workflow, or place it in a collapsed, clearly separate `Market context` section with source, timestamp, and no scoring implication.
- Export raw machine-usable values alongside formatted values. Include currency, source, retrieved/effective timestamps, Strength, Risk, coverage, flags, tier, methodology version, and sort/filter state.
- Add Playwright E2E for input → partial scan → sort/filter → expand → detail → valuation edit → save/load → peer compare → share/export.
- Add axe accessibility checks and screenshot baselines for desktop/narrow/light/dark if multiple themes are supported.
- Add API contract/property tests, including malformed/oversized JSON, non-finite provider values, provider timeout, retry exhaustion, rate-limit behavior, and refresh cooldown.
- Add branch-coverage thresholds for critical financial/data-quality logic rather than chasing an arbitrary global line percentage.

## Recommended product metrics

Do not optimize clicks or time-on-site. Optimize trust and research usefulness.

### North-star candidate

**Auditable research completion rate:** percentage of initiated company reviews in which the user inspects evidence/provenance, records or exports a case, and can later reproduce the same inputs/version.

### Supporting metrics

- Time to first useful comparison.
- Scan completion and cancellation rate.
- Partial-failure recovery rate.
- Percentage of displayed rows with sufficient data coverage.
- Percentage of score-driving observations with known source + effective date.
- Cross-source disagreement rate by metric/provider/sector.
- Methodology/evidence disclosure comprehension in user tests.
- Rate-limit/429 rate and provider calls per completed scan.
- Cache hit rate and refresh abuse rate.
- Research case revisit/reproduction success.
- Accessibility task completion and error rate.

### Guardrails

- No increase in unsupported predictive claims.
- No score/tier shown without coverage and methodology status.
- No monetary cross-company aggregation across unnormalized currencies.
- No production release with high-severity known dependency advisories without a documented, time-bounded exception.
- No paper/live-trading integration without a frozen model passing the scientific validation gates.

## Prioritized implementation roadmap

Effort is an estimate for one experienced engineer with the existing test suite. PRs should remain small enough for independent review.

### Phase 0 — Truth and safety patch (2–4 days)

| Task | Work | Primary files | Effort | Acceptance |
|---|---|---|---:|---|
| P0-A | Generate methodology from one contract; correct all 12 criteria/maxima/copy | `lib/scoring.ts`, new `lib/methodology.ts`, `app/page.tsx`, tests | 1–1.5d | Contract test prevents drift. |
| P0-B | Add experimental evidence status; remove unsupported/authority language and traffic-light dominance | `app/page.tsx`, `ResultsTable.tsx`, glosses, CSS | 0.5–1d | No predictive or “elite/fraud/fatal” copy; status always visible. |
| P0-C | Split Score into Strength/Risk/Coverage; fix sort semantics and stable ties | `app/page.tsx`, `ResultsTable.tsx`, `sort.ts`, CSV/tests | 0.5–1d | High-strength flagged rows cannot masquerade as best composite. |
| P0-D | Add scan/refresh rate limits, body schema/size limits, cooldowns, and `Retry-After` | API route, cache/rate-limit modules, tests | 1d | Abuse tests return 429 without provider calls. |
| P0-E | Remove TLS bypass; pin Node; open dependency-upgrade branch | env docs, `package.json`, runtime files, CI | 0.5d | Clean-clone checks pass under pinned LTS; TLS verification remains on. |

**Release gate:** methodology truth, evidence status, quota controls, and reproducible runtime must land before feature work.

### Phase 1 — Data trust layer (1–2 weeks)

| Task | Work | Effort | Acceptance |
|---|---|---:|---|
| P1-A | Define observation/provenance schema and migration path | 1–2d | Every visible metric can identify value, source, unit, period, retrieval time, and known effective time. |
| P1-B | Add field-level freshness/as-of UI | 1–2d | “Fetched” and “economically current” are never conflated. |
| P1-C | Add data-quality validators and drift metrics | 2d | Null/suspect/disagreement/freshness rates segmented by provider and metric. |
| P1-D | Decide USD-only vs FX-normalized scope; enforce it | 1–2d | Cross-currency cap sort/peer median is impossible. |
| P1-E | Production cache/in-flight coalescing/provider budget telemetry | 2–3d | Measured provider calls per scan fall; concurrent duplicates coalesce. |
| P1-F | Upgrade Next safely and add security headers/scanning | 1–3d | Production audit cleared or exceptions documented; E2E passes. |

### Phase 2 — Core UX redesign (1–2 weeks)

| Task | Work | Effort | Acceptance |
|---|---|---:|---|
| P2-A | Progressive results, cancel, retry-failed | 2d | User can stop and recover a scan; completed rows appear immediately. |
| P2-B | Restore focused filters and versioned share state | 2–3d | Documented screener behavior exists and round-trips. |
| P2-C | Column presets + mobile triage cards + sticky identity | 3–4d | Key tasks pass at 360px and desktop without hidden essential evidence. |
| P2-D | Methodology/evidence page and version history | 2d | User can inspect current status and prior versions without GitHub. |
| P2-E | Accessibility repair and verified WCAG 2.2 AA task set | 2–3d | Keyboard/AT/zoom/target-size gates pass. |

### Phase 3 — Valuation and peer credibility (1–2 weeks)

| Task | Work | Effort | Acceptance |
|---|---|---:|---|
| P3-A | Terminal-value contribution + two-way sensitivity | 2d | Dominant-terminal cases are obvious; assumptions are auditable. |
| P3-B | Share-count freshness and total/per-share basis repair | 1–2d | No stale annual weighted-average shares presented as current without warning. |
| P3-C | TTM/report-derived FCF reconciliation | 2–3d | Basis differences are visible and flagged. |
| P3-D | Peer comparability rules and observation counts | 2–3d | Mixed currency/model/period comparisons warn or block. |
| P3-E | Optional revenue→margin→FCF operating bridge | 3–5d | Simple and bridge models are distinct, versioned, and unit tested. |

### Phase 4 — Scientific validation (multi-month, separate research repository)

| Task | Work | Deliverable |
|---|---|---|
| P4-A | Freeze exact model and claims | Preregistered protocol and machine-readable model spec. |
| P4-B | Prove point-in-time availability for all inputs | Coverage/lag/restatement audit by criterion. |
| P4-C | Run survivorship-free validation with robust nulls | Reproducible report with uncertainty, costs, factors, and failure audit. |
| P4-D | Hold untouched forward period | Frozen prospective result. |
| P4-E | Calibrate UI status to evidence | Evidence registry consumed by the application. |

The independent `../quant-research` repository should own new experiments, consistent with the current research summary. This application should consume signed/versioned verdict artifacts rather than becoming a backtest workbench.

## Suggested PR sequence

1. **PR 1 — Methodology truth contract** (`P0-A`).
2. **PR 2 — Evidence-status and language correction** (`P0-B`).
3. **PR 3 — Strength/Risk/Coverage result model and sorting** (`P0-C`).
4. **PR 4 — API quota controls** (`P0-D`).
5. **PR 5 — Runtime pin + TLS remediation + dependency-upgrade prep** (`P0-E`).
6. **PR 6 — Observation/provenance schema** (`P1-A`, no broad UI yet).
7. **PR 7 — Field freshness and data-quality display** (`P1-B/C`).
8. **PR 8 — Currency scope and peer guards** (`P1-D`, part of `P3-D`).
9. **PR 9 — Progressive scan/cancel/retry** (`P2-A`).
10. **PR 10 — Filter/share restoration** (`P2-B`).
11. **PR 11 — Responsive table/card architecture** (`P2-C/E`).
12. **PR 12 — Valuation sensitivity and basis disclosure** (`P3-A/B/C`).

Each PR should include before/after behavior, explicit non-goals, unit/integration tests, and a short credibility review: “Could this change make the output look more certain than the evidence?”

## Release checklists

### Every product release

- [ ] `npm ci` under the pinned LTS runtime.
- [ ] Unit, typecheck, lint, build, E2E, accessibility, and dependency-audit gates pass.
- [ ] Methodology contract and rendered copy match.
- [ ] No new predictive/advisory language without a scoped evidence artifact.
- [ ] No metric loses source/unit/period/as-of metadata.
- [ ] Desktop and narrow browser QA completed.
- [ ] Provider call budget and rate-limit behavior measured.
- [ ] README and in-app help reflect shipped behavior.

### Every scoring change

- [ ] Bump `SCORING_VERSION` when behavior changes.
- [ ] Add methodology changelog entry.
- [ ] Add or update boundary, missing-data, sector/model, and non-finite tests.
- [ ] State whether the validation status remains applicable; default to “not validated” after material changes.
- [ ] Verify snapshots and change tracking do not compare incompatible eras.
- [ ] Update the machine-readable evidence registry.

### Every new data source or field

- [ ] Record endpoint, source field, units, currency, period, timestamp semantics, and provider transformation.
- [ ] Capture representative fixtures including missing, zero, negative, extreme, international, financial, REIT, restated, and delisted cases where applicable.
- [ ] Prove freshness and schema-drift behavior.
- [ ] Define cross-source reconciliation tolerance or label it single-source.
- [ ] Confirm licensing/redistribution/attribution rights before production exposure.

## What not to build yet

- Automated buy/sell/position-size recommendations.
- Brokerage execution or paper trading based on the current scorecard.
- More heuristic factors added to the composite.
- AI-generated narrative that paraphrases uncertain numbers into confident prose.
- Probabilistic valuation distributions without calibrated input distributions.
- “Official” automatic peers without validated classification and currency/period alignment.
- Sector-native metrics derived from ambiguous concepts without fixtures and independent validation.
- A single intrinsic-value point estimate.

## Decision log

| Decision | Recommendation | Rationale |
|---|---|---|
| Product identity | Research-triage and valuation notebook | Fits actual strengths and avoids unsupported decision authority. |
| Composite tier | Mark experimental now; consider removing until validated | Current visual authority exceeds evidence. |
| Currency | USD-only first unless reliable FX provenance is added | Smallest honest fix for comparability. |
| Fear & Greed | Remove from default flow | Weak task relevance and strong priming effect. |
| DCF uncertainty | Deterministic sensitivity before Monte Carlo | Transparent and does not invent distributions. |
| Research location | Keep new tests in `quant-research` | Preserves separation between product and validation engine. |
| Filters | Restore focused, evidence-aware filters | A screener needs narrowing, but filters should expose quality/risk rather than multiply heuristics. |
| Persistence | Explicit production adapter; local SQLite remains dev/self-host option | Avoids false durability on serverless. |

## Final assessment

This project should not be rebuilt from scratch. Its architecture and research discipline are good enough to evolve. The highest-return work is to make the interface as honest as the experiment log:

1. correct the methodology;
2. expose uncertainty and validation status;
3. separate Strength, Risk, and coverage;
4. protect quota and dependencies;
5. make provenance field-level;
6. redesign the mobile/core journey;
7. validate exact claims before elevating the score.

If those changes are made, the project can become unusually credible—not because it promises to find winners, but because it makes it hard for users and developers to fool themselves.
