import { describe, it, expect } from 'vitest';
import { selectComparisonSnapshot, buildSnapshotHistory } from '@/lib/snapshotHistory';
import type { SnapshotRecord } from '@/lib/store';
import type { ScanRow } from '@/lib/types';
import type { SeenMetrics } from '@/lib/seenRecords';

const NOW = Date.parse('2026-07-09T12:00:00');
function row(over: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'TSLA', companyName: 'T', industry: 'Auto', marketCap: 1e9, currency: 'USD',
    week52Low: null, week52High: null, trailingPE: null, forwardPE: null, dividendYieldPercent: null,
    ytdReturn: null, fcfYieldPercent: 5, revenueGrowthTTM: 10, debtToEquity: null, evToEbitda: 15,
    retrievedAt: '', ...over,
  };
}
const snap = (day: string, over: Partial<SnapshotRecord> = {}): SnapshotRecord => ({
  ticker: 'TSLA', day, scoringVersion: 4, tier: 'moderate', strength: 8, risk: 4,
  row: row(), retrievedAt: `${day}T00:00:00Z`, ...over,
});
const current: SeenMetrics = {
  scoringVersion: 4, tier: 'moderate', strength: 8, risk: 4, marketCap: 1e9, fcfYieldPercent: 5, revenueGrowthTTM: 10, evToEbitda: 15,
};

describe('selectComparisonSnapshot', () => {
  it('picks the closest snapshot AT OR BEFORE ~30 days, and reports the actual age', () => {
    const r = selectComparisonSnapshot([snap('2026-07-09'), snap('2026-07-04'), snap('2026-05-30'), snap('2026-05-10')], 30, NOW);
    expect(r!.snapshot.day).toBe('2026-05-30'); // ~40d — closest at/before 30, not the 60d one
    expect(r!.ageDays).toBe(40);
  });

  it('falls back to the OLDEST available when none is 30 days old', () => {
    const r = selectComparisonSnapshot([snap('2026-07-09'), snap('2026-07-07'), snap('2026-07-04')], 30, NOW);
    expect(r!.snapshot.day).toBe('2026-07-04'); // oldest prior (5d)
    expect(r!.ageDays).toBe(5);
  });

  it('excludes today and returns null when there is no prior snapshot', () => {
    expect(selectComparisonSnapshot([snap('2026-07-09')], 30, NOW)).toBeNull();
    expect(selectComparisonSnapshot([], 30, NOW)).toBeNull();
  });
});

describe('buildSnapshotHistory', () => {
  it('computes deltas vs the chosen snapshot with its actual age', () => {
    const h = buildSnapshotHistory([snap('2026-05-30', { tier: 'strong', strength: 12, risk: 2 })], current, NOW);
    expect(h!.ageDays).toBe(40);
    expect(h!.change.tierChanged).toBe(true);
    expect(h!.change.strengthDelta).toBe(-4);
  });
  it('suppresses tier/score deltas across a SCORING_VERSION change', () => {
    const h = buildSnapshotHistory([snap('2026-05-30', { scoringVersion: 3, tier: 'strong', strength: 12 })], current, NOW);
    expect(h!.change.methodologyChanged).toBe(true);
    expect(h!.change.strengthDelta).toBeNull();
  });
});
