# Inline concept glosses ("Explain") — design

**Date:** 2026-07-10
**Status:** approved (design)

## Goal

Make the tool legible to a **curious retail investor** — someone who knows
tickers, P/E, revenue growth, and YTD, but not reverse DCF, market-implied
growth, or FCF conversion. Explain the ~6 genuinely opaque concepts *in place*,
so the tool stops assuming the reader already knows what a reverse DCF is.

Primary value is **beginner comprehension**. Explicit non-goal: adding
**benchmark authority** — the glosses must not pose as an arbiter of what a
"normal" or "fair" value is.

## Constraints (unchanged product rules)

- **Informational only.** No buy/sell/hold, no price target, no verdict, no
  directional judgment ("overvalued", "cheap → buy"). A gloss frames what a
  number *means* and how it relates to other numbers already on the page; the
  user still draws the conclusion.
- **No black-box summaries.** Every gloss is deterministic, per-concept, and
  auditable — a pure function of values already computed. No LLM, no generated
  narrative.
- **Missing ≠ zero.** A gloss whose contextual inputs are absent drops its
  contextual line entirely; it never fabricates a comparison or a value.

## Scope

**In — the opaque concepts, glossed where they already render:**

| Concept | Renders in |
| --- | --- |
| Market Expectations / implied growth | `components/MarketExpectationsCard.tsx` |
| Reverse DCF | `components/DcfPanel.tsx` |
| Bear / base / bull scenarios | `components/ScenarioPanel.tsx` |
| Strength / Risk / Tier | detail header (`app/[ticker]/page.tsx`) |
| FCF conversion (Earnings Quality) | score-breakdown row (`components/ResultsTable.tsx`) |
| Scorecard flags (value trap, serviceable leverage, peak cycle, soft EQ, insufficient data) | score-breakdown row (`components/ResultsTable.tsx`) |

Note the wiring spans **two surfaces**: the per-ticker detail-page panels, and
the home-table expandable score-breakdown row (where flags + Earnings Quality
actually live — they are *not* on the detail page today). This is deliberate:
gloss each concept where the reader encounters the jargon, without inventing new
panels.

**Out (say so to add later):** familiar metrics (P/E, div yield, YTD, rev
growth); table-column header tooltips; a standalone glossary/reference page; any
onboarding tour; any generated narrative summary; **external benchmark
constants** (dropped per review — see below).

## Design

### Data — `lib/explain/glosses.ts`

One pure function per concept, each returning:

```ts
interface Gloss {
  term: string;        // human label, e.g. "Implied growth"
  define: string;      // static: what the concept IS + what higher/lower means
  read?: string | null;// contextual: what it says HERE; null when inputs absent
}
```

- `define` — the fixed teaching sentence: what the concept is, and what a
  higher-vs-lower value **mechanically** implies. No benchmark claims.
- `read` — an optional contextual line built **only from values already shown on
  the same page** (internal comparisons): implied-vs-delivered growth,
  forward-vs-trailing P/E, the scenario band vs the current price, the
  strength/risk split behind the tier. Returns `null` when its inputs are absent.

Functions: `impliedGrowthGloss(impliedPct, deliveredPct)`,
`reverseDcfGloss()`, `scenarioGloss(current, low, high)`,
`tierGloss(tier, strength, risk)`, `fcfConversionGloss(ratio)`,
`flagGloss(flag)` (one function covers every flag id).

These are independent, individually-testable pure functions — **not** a
union-typed registry. The panel calls the relevant function and passes the
result to `<Explain>`.

**No `references.ts` / no external benchmark constants.** An earlier draft
compared each value to a sourced market median (e.g. "~4% long-run FCF growth").
Dropped: it implies the tool is an authority on the "right" benchmark, and it is
content to source, hedge, and maintain. Mechanical internal comparisons carry
the comprehension value without the authority claim.

### Rendering — `components/Explain.tsx`

Server component. Renders a `Gloss` as a native HTML disclosure:

```
<details class="explain">
  <summary>{term} <span aria-hidden>?</span></summary>
  <div>
    <p>{define}</p>
    {read && <p>{read}</p>}
  </div>
</details>
```

Native `<details>` = collapsed by default, accessible by default, zero client
JS, works in server components, valid inside a table cell (the ResultsTable
breakdown row). Styling in `app/globals.css` under `.explain`.

### Wiring

Drop `<Explain gloss={fn(...)} />` beside each concept at the six render sites
above. `flagGloss(flag)` is mapped over the flags already listed in the
breakdown row.

### Tone enforcement — `test/explain.test.ts`

The tone boundary is enforced by test, not just convention:

- **No directional-verdict language** in any gloss body. Narrow banned list:
  `buy`, `sell`, `overvalued`, `undervalued`, `price target`. Deliberately
  **not** banning descriptive terms like "optically cheap" — the value-trap flag
  legitimately uses that phrasing to define itself.
- **Per-gloss behavior:** representative inputs produce a body that mentions the
  concept and, where applicable, the internal contextual values; a `null`/absent
  input omits the `read` line and does not throw.

## Testing

Pure gloss functions → assert output strings directly. The tone guard iterates
every gloss. No network. Runs under the existing gates
(`npm test && npm run typecheck && npm run lint && npm run build`).

## Files

- **New:** `lib/explain/glosses.ts`, `components/Explain.tsx`,
  `test/explain.test.ts`
- **Edit:** `components/MarketExpectationsCard.tsx`, `components/DcfPanel.tsx`,
  `components/ScenarioPanel.tsx`, `app/[ticker]/page.tsx`,
  `components/ResultsTable.tsx`, `app/globals.css`
- **Docs:** this spec

## Out of scope / later

Table-column tooltips, a glossary page, onboarding, narrative summaries, and
external benchmark constants — each a deliberate deferral, not an oversight.
