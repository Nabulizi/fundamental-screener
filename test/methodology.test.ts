import { describe, expect, it } from 'vitest';
import { getScoringMethodology } from '@/lib/methodology';
import { CRITERION_KEYS, MAX_RISK, MAX_STRENGTH, SCORING_VERSION } from '@/lib/scoring';

describe('reader-facing scoring methodology contract', () => {
  it('stays in lockstep with the scoring implementation', () => {
    const methodology = getScoringMethodology();
    expect(methodology.version).toBe(SCORING_VERSION);
    expect(methodology.criterionCount).toBe(CRITERION_KEYS.length);
    expect(methodology.criteria.map((c) => c.key)).toEqual(CRITERION_KEYS);
    expect(methodology.maxStrength).toBe(MAX_STRENGTH);
    expect(methodology.maxRisk).toBe(MAX_RISK);
    expect(methodology.criteria.every((c) => c.benchmark.positive && c.benchmark.negative)).toBe(true);
  });
});
