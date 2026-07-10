import type { SnapshotRecord } from './store';
import { computeChangeSince, type SeenMetrics, type SeenRecord, type ChangeSummary } from './seenRecords';

// Server-longitudinal "vs a stored snapshot" — the objective complement to the
// client "since you last viewed". Pure; reuses computeChangeSince (so the
// SCORING_VERSION-era suppression is identical).

export function snapshotToMetrics(s: SnapshotRecord): SeenMetrics {
  return {
    scoringVersion: s.scoringVersion, tier: s.tier, strength: s.strength, risk: s.risk,
    marketCap: s.row.marketCap, fcfYieldPercent: s.row.fcfYieldPercent,
    revenueGrowthTTM: s.row.revenueGrowthTTM, evToEbitda: s.row.evToEbitda,
  };
}

function ageDays(day: string, now: number): number {
  return Math.floor((now - Date.parse(`${day}T00:00:00`)) / 86_400_000);
}

/**
 * Choose the comparison snapshot: the one closest to (at or before) `targetDays`
 * ago; if none is that old, the OLDEST available prior snapshot. Today's is
 * excluded. Returns the pick and its ACTUAL age (so the UI labels "11 days" /
 * "52 days", not a fake "30 days").
 */
export function selectComparisonSnapshot(
  snapshots: SnapshotRecord[], targetDays: number, now: number
): { snapshot: SnapshotRecord; ageDays: number } | null {
  const prior = snapshots
    .map((s) => ({ snapshot: s, ageDays: ageDays(s.day, now) }))
    .filter((x) => x.ageDays >= 1); // exclude today's snapshot
  if (prior.length === 0) return null;

  const atOrBefore = prior.filter((x) => x.ageDays >= targetDays);
  if (atOrBefore.length) return atOrBefore.reduce((a, b) => (a.ageDays <= b.ageDays ? a : b)); // closest ≥ target
  return prior.reduce((a, b) => (a.ageDays >= b.ageDays ? a : b)); // oldest available
}

export function buildSnapshotHistory(
  snapshots: SnapshotRecord[], current: SeenMetrics, now: number, targetDays = 30
): { change: ChangeSummary; ageDays: number } | null {
  const sel = selectComparisonSnapshot(snapshots, targetDays, now);
  if (!sel) return null;
  const prior: SeenRecord = { ...snapshotToMetrics(sel.snapshot), ticker: sel.snapshot.ticker, seenAt: sel.snapshot.retrievedAt };
  return { change: computeChangeSince(prior, current), ageDays: sel.ageDays };
}
