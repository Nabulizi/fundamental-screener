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
  impliedOutOfRange: boolean,
  deliveredRevGrowthPct: number | null,
): Gloss {
  const define =
    "Implied growth is the yearly free-cash-flow growth today's share price already assumes — " +
    'found by running a discounted-cash-flow model backwards from the current market value. ' +
    "It's what you'd have to believe to justify the price, not a forecast and not a fair value.";

  let read: string | null = null;
  if (impliedPct != null) {
    // Match the panel's clamped display (">100%" / "<-50%") so the explanation
    // never disagrees with the number shown directly above it.
    const valuePhrase = impliedOutOfRange
      ? `${impliedPct > 0 ? 'more than' : 'less than'} ${impliedPct.toFixed(0)}%/yr`
      : `roughly ${impliedPct.toFixed(1)}%/yr`;
    read = `The price implies ${valuePhrase}.`;
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
      'tier (Strong / Moderate / Weak) starts from the Strength score, then risk, data-quality, and ' +
      'overlay rules (disqualifiers, insufficient data, crowding, value-trap, peak-cycle, soft ' +
      'earnings quality) can floor or cap it. It is a neutral label, not a rating and not a recommendation.',
    read: `Here: Strength ${strength}, Risk ${risk} → ${tier}. A high Strength narrows what to research next; it isn't a conclusion on its own.`,
  };
}
