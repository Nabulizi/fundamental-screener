import { describe, it, expect } from 'vitest';
import {
  impliedGrowthGloss, reverseDcfGloss, scenarioGloss, tierGloss, type Gloss,
} from '@/lib/explain/glosses';

const body = (g: Gloss) => `${g.define} ${g.read ?? ''}`;

describe('gloss functions', () => {
  it('impliedGrowthGloss states the concept and compares implied vs delivered when both present', () => {
    const g = impliedGrowthGloss(8.6, false, 5.1);
    expect(g.define.toLowerCase()).toContain('backwards');
    expect(g.read).toContain('roughly 8.6%/yr');
    expect(g.read).toContain('5.1');
  });

  it('impliedGrowthGloss keeps the concept but drops the comparison when delivered is absent', () => {
    const g = impliedGrowthGloss(8.6, false, null);
    expect(g.read).toContain('8.6');
    expect(g.read).not.toContain('Recent revenue'); // no comparison clause
  });

  it('impliedGrowthGloss matches the panel clamp for out-of-range values (no "two numbers" mismatch)', () => {
    // Panel renders ">100%" / "<-50%"; the gloss must not print an exact clamped number.
    expect(impliedGrowthGloss(100, true, null).read).toContain('more than 100%/yr');
    expect(impliedGrowthGloss(100, true, null).read).not.toContain('100.0%');
    expect(impliedGrowthGloss(-50, true, null).read).toContain('less than -50%/yr');
  });

  it('impliedGrowthGloss has no contextual read when implied is unavailable (missing ≠ zero)', () => {
    expect(impliedGrowthGloss(null, false, 5.1).read).toBeNull();
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
    impliedGrowthGloss(8.6, false, 5.1),
    impliedGrowthGloss(100, true, null),
    impliedGrowthGloss(null, false, null),
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
