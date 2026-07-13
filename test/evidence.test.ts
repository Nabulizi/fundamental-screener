import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_REGISTRY, VERDICT_LABEL, scorecardEvidence } from '@/lib/evidence';
import { SCORING_VERSION } from '@/lib/scoring';

describe('evidence registry', () => {
  it('entries are complete: unique ids, claim, scope, valid verdict and date', () => {
    const ids = EVIDENCE_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EVIDENCE_REGISTRY) {
      expect(e.claim.length).toBeGreaterThan(10);
      expect(e.scope.length).toBeGreaterThan(10);
      expect(VERDICT_LABEL[e.verdict]).toBeDefined();
      expect(Number.isFinite(Date.parse(e.asOf))).toBe(true);
    }
  });

  it('every cited source document exists in the repo', () => {
    for (const e of EVIDENCE_REGISTRY) {
      expect(existsSync(path.join(process.cwd(), e.source)), `${e.id} → ${e.source}`).toBe(true);
    }
  });

  // The load-bearing contract (roadmap: every scoring change must update the
  // registry): bumping SCORING_VERSION without stating the new version's
  // evidence status fails here. Add an entry for the new version — default
  // verdict 'untested' — rather than weakening this test.
  it('the shipped scorecard version has a registry entry', () => {
    const entry = scorecardEvidence(SCORING_VERSION);
    expect(entry, `no evidence entry for SCORING_VERSION=${SCORING_VERSION}`).toBeDefined();
  });

  it('a supported-within-scope verdict must state its scope boundary', () => {
    for (const e of EVIDENCE_REGISTRY.filter((x) => x.verdict === 'supported-within-scope')) {
      // The scope must say what is NOT covered, not just what passed.
      expect(e.scope.toLowerCase()).toMatch(/only|no |not /);
    }
  });
});
