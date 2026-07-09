import { describe, it, expect } from 'vitest';
import {
  computeChangeSince, serialize, parseStored, findSeen, upsertSeen,
  type SeenMetrics, type SeenRecord,
} from '@/lib/seenRecords';

const cur = (over: Partial<SeenMetrics> = {}): SeenMetrics => ({
  scoringVersion: 4, tier: 'moderate', strength: 8, risk: 4,
  marketCap: 1e9, fcfYieldPercent: 5, revenueGrowthTTM: 10, evToEbitda: 15, impliedGrowthPct: 20, ...over,
});
const rec = (over: Partial<SeenRecord> = {}): SeenRecord => ({ ...cur(), ticker: 'TSLA', seenAt: '2026-06-01T00:00:00Z', ...over });

describe('computeChangeSince', () => {
  it('first view (no prior) reports firstView and no deltas', () => {
    const c = computeChangeSince(null, cur());
    expect(c.firstView).toBe(true);
    expect(c.anyChange).toBe(false);
  });

  it('computes tier / score / metric deltas', () => {
    const prior = rec({ tier: 'strong', strength: 12, risk: 2, fcfYieldPercent: 6, evToEbitda: 20, impliedGrowthPct: 14 });
    const c = computeChangeSince(prior, cur()); // now moderate/8/4, fcf 5, ev 15, implied 20
    expect(c.tierChanged).toBe(true);
    expect(c.tierFrom).toBe('strong');
    expect(c.tierTo).toBe('moderate');
    expect(c.strengthDelta).toBe(-4);
    expect(c.riskDelta).toBe(2);
    const fcf = c.metricDeltas.find((d) => d.key === 'fcfYield')!;
    expect(fcf.delta).toBe(-1);
    expect(c.metricDeltas.find((d) => d.key === 'impliedGrowth')!.delta).toBe(6);
    expect(c.anyChange).toBe(true);
  });

  it('suppresses tier/score deltas across a SCORING_VERSION change, keeps metric deltas + note', () => {
    const prior = rec({ scoringVersion: 3, tier: 'strong', strength: 12, risk: 2, fcfYieldPercent: 6 });
    const c = computeChangeSince(prior, cur({ scoringVersion: 4 }));
    expect(c.methodologyChanged).toBe(true);
    expect(c.tierChanged).toBe(false);
    expect(c.strengthDelta).toBeNull();
    expect(c.riskDelta).toBeNull();
    expect(c.metricDeltas.find((d) => d.key === 'fcfYield')!.delta).toBe(-1); // metrics still compared
  });

  it('a missing metric yields a null delta, never a fake 0', () => {
    const prior = rec({ fcfYieldPercent: null });
    const c = computeChangeSince(prior, cur({ fcfYieldPercent: 5 }));
    expect(c.metricDeltas.find((d) => d.key === 'fcfYield')!.delta).toBeNull();
  });

  it('no change → anyChange false', () => {
    expect(computeChangeSince(rec(), cur()).anyChange).toBe(false);
  });
});

describe('seenRecords store', () => {
  it('serialize → parseStored round-trips; tolerates junk; drops malformed', () => {
    expect(parseStored(serialize([rec()]))).toHaveLength(1);
    expect(parseStored('nope')).toEqual([]);
    expect(parseStored(JSON.stringify({ records: [{ ticker: 'X' }, rec()] }))).toHaveLength(1); // first has no seenAt
  });

  it('upsertSeen replaces by ticker; findSeen is case-insensitive', () => {
    const one = upsertSeen([], rec({ strength: 8 }));
    const two = upsertSeen(one, rec({ strength: 11 }));
    expect(two).toHaveLength(1);
    expect(findSeen(two, 'tsla')!.strength).toBe(11);
  });
});
