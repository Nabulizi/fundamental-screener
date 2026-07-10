# Inline Concept Glosses ("Explain") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain the four opaque valuation concepts on the detail page (implied growth, reverse DCF, scenarios, tier/strength/risk) in plain language, in place, so a curious retail investor can read the tool without a finance background.

**Architecture:** One pure module of per-concept gloss functions (`lib/explain/glosses.ts`) returning `{ term, define, read }`, rendered by a single presentational `<Explain>` component as a native `<details>` disclosure. The functions are pure and unit-tested; the component is plain (no client JS, no server-only deps) so it drops into both server and client components. Contextual `read` lines use only values already on the page — no external benchmarks.

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest (+ Testing Library / jsdom for the component test), native HTML `<details>`.

## Global Constraints

- **Informational only** — no buy/sell/hold, no price target, no verdict, no directional ("overvalued"/"cheap→buy") language. Enforced by a test.
- **No black-box summaries** — glosses are deterministic pure functions of already-computed values; no LLM, no generated narrative.
- **Missing ≠ zero** — when a gloss's contextual inputs are absent, its `read` is `null` (the line is omitted); never fabricate a value or comparison.
- **No external benchmark constants** — contextual comparisons use only values already shown on the same page.
- Before claiming done, all four gates must pass: `npm test && npm run typecheck && npm run lint && npm run build`.
- First pass is the **four detail-page concepts only**. Flags + Earnings-Quality (home-table breakdown) already have explanatory `title` tooltips and are a deliberate fast-follow, out of scope here.

---

### Task 1: Gloss functions (pure core) + tests

**Files:**
- Create: `lib/explain/glosses.ts`
- Test: `test/explain.test.ts`

**Interfaces:**
- Consumes: `SignalTier` from `@/lib/scoring` (existing: `'strong' | 'moderate' | 'weak'`).
- Produces:
  - `interface Gloss { term: string; define: string; read: string | null; }`
  - `impliedGrowthGloss(impliedPct: number | null, deliveredRevGrowthPct: number | null): Gloss`
  - `reverseDcfGloss(): Gloss`
  - `scenarioGloss(): Gloss`
  - `tierGloss(tier: SignalTier, strength: number, risk: number): Gloss`

- [ ] **Step 1: Write the failing tests**

Create `test/explain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  impliedGrowthGloss, reverseDcfGloss, scenarioGloss, tierGloss, type Gloss,
} from '@/lib/explain/glosses';

const body = (g: Gloss) => `${g.define} ${g.read ?? ''}`;

describe('gloss functions', () => {
  it('impliedGrowthGloss states the concept and compares implied vs delivered when both present', () => {
    const g = impliedGrowthGloss(8.6, 5.1);
    expect(g.define.toLowerCase()).toContain('backwards');
    expect(g.read).toContain('8.6');
    expect(g.read).toContain('5.1');
  });

  it('impliedGrowthGloss keeps the concept but drops the comparison when delivered is absent', () => {
    const g = impliedGrowthGloss(8.6, null);
    expect(g.read).toContain('8.6');
    expect(g.read).not.toContain('%/yr —'); // no comparison clause
  });

  it('impliedGrowthGloss has no contextual read when implied is unavailable (missing ≠ zero)', () => {
    expect(impliedGrowthGloss(null, 5.1).read).toBeNull();
  });

  it('reverseDcfGloss is definitional (no per-company read)', () => {
    const g = reverseDcfGloss();
    expect(g.define.toLowerCase()).toContain('solves');
    expect(g.read).toBeNull();
  });

  it('scenarioGloss is definitional', () => {
    const g = scenarioGloss();
    expect(g.define.toLowerCase()).toContain('what-if');
    expect(g.read).toBeNull();
  });

  it('tierGloss explains the split and reports this row', () => {
    const g = tierGloss('strong', 14, 3);
    expect(g.define.toLowerCase()).toContain('separate');
    expect(g.read).toContain('14');
    expect(g.read).toContain('3');
    expect(g.read).toContain('strong');
  });
});

describe('tone boundary (no directional-verdict language)', () => {
  const samples: Gloss[] = [
    impliedGrowthGloss(8.6, 5.1),
    impliedGrowthGloss(null, null),
    reverseDcfGloss(),
    scenarioGloss(),
    tierGloss('moderate', 9, 6),
  ];
  // Narrow, deliberate list — descriptive terms like "optically cheap" stay allowed.
  const banned = /\b(buy|sell|overvalued|undervalued)\b/i;
  it('no gloss body contains buy/sell/overvalued/undervalued or a price target', () => {
    for (const g of samples) {
      const text = body(g);
      expect(banned.test(text), `banned word in: ${text}`).toBe(false);
      expect(/price target/i.test(text), `price target in: ${text}`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/explain.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/explain/glosses"`.

- [ ] **Step 3: Write the implementation**

Create `lib/explain/glosses.ts`:

```ts
import type { SignalTier } from '@/lib/scoring';

// Plain-language explanations of the opaque valuation concepts, for a curious
// retail investor. Pure and deterministic. `define` is the fixed teaching
// sentence; `read` is an optional per-company line built ONLY from values
// already shown on the same page (no external benchmarks). No verdicts — see
// the tone-boundary test in test/explain.test.ts.

export interface Gloss {
  term: string;
  define: string;
  read: string | null;
}

export function impliedGrowthGloss(
  impliedPct: number | null,
  deliveredRevGrowthPct: number | null,
): Gloss {
  const define =
    "Implied growth is the yearly free-cash-flow growth today's share price already assumes — " +
    'found by running a discounted-cash-flow model backwards from the current market value. ' +
    "It's what you'd have to believe to justify the price, not a forecast and not a fair value.";

  let read: string | null = null;
  if (impliedPct != null) {
    read = `The price implies roughly ${impliedPct.toFixed(1)}%/yr.`;
    if (deliveredRevGrowthPct != null) {
      read +=
        ` Recent revenue grew about ${deliveredRevGrowthPct.toFixed(1)}%/yr — the further implied growth` +
        ' sits above that, the more the price leans on future margin gains or faster growth.';
    }
  }
  return { term: 'What is implied growth?', define, read };
}

export function reverseDcfGloss(): Gloss {
  return {
    term: 'What is a reverse DCF?',
    define:
      'A normal DCF assumes a growth rate and estimates a value. A reverse DCF does the opposite: ' +
      "it takes today's price as given and solves for the single growth rate that makes the model " +
      'balance. It answers “what is the market assuming?” rather than “what is it worth?”, ' +
      "which is why the tool reports what's priced in instead of telling you what to pay.",
    read: null,
  };
}

export function scenarioGloss(): Gloss {
  return {
    term: 'How to read these scenarios',
    define:
      "Each column is a what-if: the company's value if free-cash-flow growth lands below (Bear), " +
      'near (Base), or above (Bull) what the price implies. Base starts at the implied rate. These ' +
      'are assumptions to stress-test, not predictions, and nothing here is a recommendation.',
    read: null,
  };
}

export function tierGloss(tier: SignalTier, strength: number, risk: number): Gloss {
  return {
    term: 'What do Strength, Risk, and tier mean?',
    define:
      'Strength (0–21) adds up the positive fundamental signals; Risk (0–20) adds up the ' +
      "warning signals. They're separate on purpose — a company can be both strong and risky. The " +
      'tier (Strong / Moderate / Weak) just summarizes the Strength score; it is a neutral label, ' +
      'not a rating and not a recommendation.',
    read: `Here: Strength ${strength}, Risk ${risk} → ${tier}. A high Strength narrows what to research next; it isn't a conclusion on its own.`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/explain.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/explain/glosses.ts test/explain.test.ts
git commit -m "feat: add concept gloss functions + tone-boundary test"
```

---

### Task 2: `<Explain>` component + render test + styles

**Files:**
- Create: `components/Explain.tsx`
- Create: `test/Explain.test.tsx`
- Modify: `app/globals.css` (append an `.explain` block)

**Interfaces:**
- Consumes: `Gloss` from `@/lib/explain/glosses` (Task 1).
- Produces: default export `Explain({ gloss }: { gloss: Gloss })` — a native `<details class="explain">` disclosure.

- [ ] **Step 1: Write the failing test**

Create `test/Explain.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Explain from '@/components/Explain';

afterEach(() => cleanup());

describe('Explain', () => {
  it('renders the definition and the read line when present', () => {
    render(<Explain gloss={{ term: 'Term', define: 'Definition here', read: 'Read here' }} />);
    expect(screen.getByText('Definition here')).toBeTruthy();
    expect(screen.getByText('Read here')).toBeTruthy();
  });

  it('omits the read paragraph when read is null', () => {
    render(<Explain gloss={{ term: 'Term', define: 'Definition here', read: null }} />);
    expect(screen.queryByText('Read here')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/Explain.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/Explain"`.

- [ ] **Step 3: Write the component**

Create `components/Explain.tsx`:

```tsx
import type { Gloss } from '@/lib/explain/glosses';

// Presentational disclosure for one concept gloss. Native <details> — collapsed
// by default, accessible by default, zero client JS, valid in both server and
// client components. Neutral: states what a number means, never a verdict.
export default function Explain({ gloss }: { gloss: Gloss }) {
  return (
    <details className="explain">
      <summary>
        {gloss.term}
        <span className="explain-mark" aria-hidden="true">?</span>
      </summary>
      <div className="explain-body">
        <p>{gloss.define}</p>
        {gloss.read && <p>{gloss.read}</p>}
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/Explain.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Add styles**

Append to `app/globals.css`:

```css
/* Inline concept glosses (components/Explain.tsx) — a quiet "learn more" toggle. */
.explain {
  margin: 0.4rem 0 0;
  font-size: 0.85rem;
}
.explain > summary {
  cursor: pointer;
  color: var(--muted, #6b7280);
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.explain > summary::-webkit-details-marker { display: none; }
.explain-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 0.7rem;
  line-height: 1;
}
.explain[open] > summary { margin-bottom: 0.35rem; }
.explain-body {
  color: var(--muted, #6b7280);
  line-height: 1.5;
  max-width: 60ch;
}
.explain-body p { margin: 0 0 0.4rem; }
.explain-body p:last-child { margin-bottom: 0; }
```

- [ ] **Step 6: Commit**

```bash
git add components/Explain.tsx test/Explain.test.tsx app/globals.css
git commit -m "feat: add Explain disclosure component + styles"
```

---

### Task 3: Wire glosses into the four detail-page render sites

**Files:**
- Modify: `components/MarketExpectationsCard.tsx`
- Modify: `components/DcfPanel.tsx`
- Modify: `components/ScenarioPanel.tsx`
- Modify: `app/[ticker]/page.tsx`

**Interfaces:**
- Consumes: `Explain` (Task 2), `impliedGrowthGloss`/`reverseDcfGloss`/`scenarioGloss`/`tierGloss` (Task 1).
- Produces: no new exports — integration only. Deliverable verified by the full gate suite (there is no unit test for wiring; the panels render server/client-side).

- [ ] **Step 1: Wire the Market Expectations card**

In `components/MarketExpectationsCard.tsx`, add imports at the top:

```ts
import Explain from '@/components/Explain';
import { impliedGrowthGloss } from '@/lib/explain/glosses';
```

Then inside the `<div className="mx-implied">` block, immediately after the `<span className="hint">…</span>` that ends the implied section (before the closing `</div>` of `mx-implied`), add:

```tsx
        <Explain gloss={impliedGrowthGloss(model.impliedPct, model.delivered.revenueGrowthTTM)} />
```

- [ ] **Step 2: Wire the reverse-DCF panel**

In `components/DcfPanel.tsx`, add imports at the top (below the existing imports):

```ts
import Explain from '@/components/Explain';
import { reverseDcfGloss } from '@/lib/explain/glosses';
```

Then immediately after the intro `<p className="hint">…</p>` (the one ending "…not a target.") and before the `{!valid ? (` block, add:

```tsx
      <Explain gloss={reverseDcfGloss()} />
```

- [ ] **Step 3: Wire the scenario panel**

In `components/ScenarioPanel.tsx`, add imports at the top (below the existing imports):

```ts
import Explain from '@/components/Explain';
import { scenarioGloss } from '@/lib/explain/glosses';
```

Then immediately after the intro `<p className="hint">…</p>` (ending "…informational only.") and before the `{anchor.pct != null && (` block, add:

```tsx
      <Explain gloss={scenarioGloss()} />
```

- [ ] **Step 4: Wire the detail-page tier header**

In `app/[ticker]/page.tsx`, add imports alongside the existing component imports:

```ts
import Explain from '@/components/Explain';
import { tierGloss } from '@/lib/explain/glosses';
```

Then in the `<header className="detail-head">`, immediately after the closing `</div>` of the `<div className={`tier tier-${scored.tier}`}>` block and before the header's closing `</header>`, add:

```tsx
        <Explain gloss={tierGloss(scored.tier, scored.strengthScore, scored.riskScore)} />
```

- [ ] **Step 5: Run the full gate suite**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass — 40x tests green (Task 1 + Task 2 additions), no type/lint errors, build compiles `/[ticker]`.

- [ ] **Step 6: Manual sanity (optional but recommended)**

Run: `NODE_TLS_REJECT_UNAUTHORIZED=0 npm run dev`, open `http://localhost:3000/AAPL`, confirm four "?" disclosures appear (Market expectations, reverse DCF, scenarios, tier header), each collapsed by default and expanding to plain-language text with no buy/sell wording.

- [ ] **Step 7: Commit**

```bash
git add components/MarketExpectationsCard.tsx components/DcfPanel.tsx components/ScenarioPanel.tsx "app/[ticker]/page.tsx"
git commit -m "feat: wire concept glosses into the four detail-page panels"
```

---

## Self-Review

**Spec coverage:**
- Beginner-comprehension glosses for the opaque concepts → Tasks 1–3. First-pass scope (four detail-page concepts) matches the confirmed decision; flags/Earnings-Quality deferred per the same decision (noted in Global Constraints).
- Pure per-concept functions + native `<details>` component → Tasks 1, 2.
- Internal mechanical comparisons only, no external benchmarks → `impliedGrowthGloss` uses `model.impliedPct` + `model.delivered.revenueGrowthTTM`; no `references.ts` created.
- Tone boundary enforced by test → Task 1 tone-boundary block.
- Missing ≠ zero → `impliedGrowthGloss(null, …)` returns `read: null`; tested.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `Gloss` shape and the four function signatures are identical across Task 1 (definition), Task 1 tests, Task 2 (component prop + test), and Task 3 (call sites). `SignalTier` is the existing `@/lib/scoring` union. `model.impliedPct` and `model.delivered.revenueGrowthTTM` match `MarketExpectations` as rendered in `MarketExpectationsCard.tsx`.

**Fast-follow (out of scope):** convert the ResultsTable flag + Earnings-Quality `title` tooltips into discoverable `<Explain>` disclosures.
