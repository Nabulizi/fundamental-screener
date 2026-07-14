import {
  CRITERION_BENCHMARK,
  CRITERION_KEYS,
  CRITERION_LABELS,
  CRITERION_WEIGHT,
  MAX_RISK,
  MAX_STRENGTH,
  RISK_FLOOR,
  SCORING_VERSION,
  type ScoreBreakdown,
} from './scoring';

/**
 * Reader-facing scoring contract. Keep the implementation and explanation in
 * one place: the UI, exports, and contract tests consume this shape rather than
 * repeating criterion counts or score ranges in prose.
 */
export function getScoringMethodology() {
  return {
    version: SCORING_VERSION,
    status: 'Experimental heuristic — not validated for returns',
    criterionCount: CRITERION_KEYS.length,
    maxStrength: MAX_STRENGTH,
    maxRisk: MAX_RISK,
    riskFloor: RISK_FLOOR,
    criteria: CRITERION_KEYS.map((key) => ({
      key,
      label: CRITERION_LABELS[key],
      weight: CRITERION_WEIGHT[key],
      benchmark: CRITERION_BENCHMARK[key],
    })),
    tierRules: [
      { key: 'strong', label: 'Higher alignment', rule: `Strength ≥ 12, with no hard floor or limiting flag` },
      { key: 'moderate', label: 'Mixed signals', rule: 'Strength ≥ 7, or a limiting flag applies' },
      { key: 'weak', label: 'Insufficient / flagged', rule: `Strength < 7, Risk ≥ ${RISK_FLOOR}, insufficient data, or a hard floor` },
    ],
  } as const;
}

export type ScoringMethodology = ReturnType<typeof getScoringMethodology>;

// Compile-time guard: if the scoring keys change, the methodology contract must
// continue to be able to describe every criterion.
export type MethodologyCriterionKey = keyof ScoreBreakdown;
