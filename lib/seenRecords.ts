// "Since you last viewed" change tracking — per-user, client-side. Pure model +
// serialization + the delta computation here; the panel owns localStorage. No
// server infra. Neutral facts only (direction + magnitude), never a verdict.

import type { SignalTier } from './scoring';

export interface SeenMetrics {
  scoringVersion: number;
  tier: SignalTier;
  strength: number;
  risk: number;
  marketCap: number | null;
  fcfYieldPercent: number | null;
  revenueGrowthTTM: number | null;
  evToEbitda: number | null;
  /** Market-implied FCF growth (%), TTM-base — null when unavailable/gated. */
  impliedGrowthPct: number | null;
}

export interface SeenRecord extends SeenMetrics {
  ticker: string;
  seenAt: string;
}

export const STORAGE_KEY = 'stock-scanner.seenRecords.v1';
const SCHEMA_VERSION = 1;

export interface MetricDelta {
  key: 'fcfYield' | 'revenueGrowth' | 'evEbitda' | 'impliedGrowth';
  label: string;
  from: number | null;
  to: number | null;
  /** to − from, or null when either endpoint is missing (never a fake 0). */
  delta: number | null;
  unit: 'pp' | 'x';
}

export interface ChangeSummary {
  firstView: boolean;
  /** Scoring methodology changed since last view — tier/score deltas suppressed. */
  methodologyChanged: boolean;
  tierFrom: SignalTier | null;
  tierTo: SignalTier | null;
  tierChanged: boolean;
  strengthDelta: number | null;
  riskDelta: number | null;
  metricDeltas: MetricDelta[];
  /** True when anything changed (tier, score, or a metric). */
  anyChange: boolean;
}

function delta(from: number | null, to: number | null): number | null {
  return from != null && to != null ? to - from : null;
}

export function computeChangeSince(prior: SeenRecord | null, current: SeenMetrics): ChangeSummary {
  const metricDeltas: MetricDelta[] = [
    { key: 'fcfYield', label: 'FCF yield', from: prior?.fcfYieldPercent ?? null, to: current.fcfYieldPercent, delta: delta(prior?.fcfYieldPercent ?? null, current.fcfYieldPercent), unit: 'pp' },
    { key: 'revenueGrowth', label: 'Revenue growth', from: prior?.revenueGrowthTTM ?? null, to: current.revenueGrowthTTM, delta: delta(prior?.revenueGrowthTTM ?? null, current.revenueGrowthTTM), unit: 'pp' },
    { key: 'evEbitda', label: 'EV/EBITDA', from: prior?.evToEbitda ?? null, to: current.evToEbitda, delta: delta(prior?.evToEbitda ?? null, current.evToEbitda), unit: 'x' },
    { key: 'impliedGrowth', label: 'Market-implied FCF growth', from: prior?.impliedGrowthPct ?? null, to: current.impliedGrowthPct, delta: delta(prior?.impliedGrowthPct ?? null, current.impliedGrowthPct), unit: 'pp' },
  ];

  if (!prior) {
    return { firstView: true, methodologyChanged: false, tierFrom: null, tierTo: null, tierChanged: false, strengthDelta: null, riskDelta: null, metricDeltas, anyChange: false };
  }

  const methodologyChanged = prior.scoringVersion !== current.scoringVersion;
  // Tier/score are methodology-dependent — suppress their deltas across eras.
  const tierChanged = !methodologyChanged && prior.tier !== current.tier;
  const strengthDelta = methodologyChanged ? null : current.strength - prior.strength;
  const riskDelta = methodologyChanged ? null : current.risk - prior.risk;

  const anyChange =
    tierChanged ||
    (strengthDelta != null && strengthDelta !== 0) ||
    (riskDelta != null && riskDelta !== 0) ||
    metricDeltas.some((d) => d.delta != null && d.delta !== 0) ||
    methodologyChanged;

  return {
    firstView: false,
    methodologyChanged,
    tierFrom: methodologyChanged ? null : prior.tier,
    tierTo: methodologyChanged ? null : current.tier,
    tierChanged,
    strengthDelta,
    riskDelta,
    metricDeltas,
    anyChange,
  };
}

// --- localStorage store (pure) ----------------------------------------------

export function serialize(records: SeenRecord[]): string {
  return JSON.stringify({ version: SCHEMA_VERSION, records });
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function coerce(x: unknown): SeenRecord | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.ticker !== 'string' || typeof o.seenAt !== 'string') return null;
  const tier = o.tier;
  if (tier !== 'strong' && tier !== 'moderate' && tier !== 'weak') return null;
  return {
    ticker: o.ticker.toUpperCase(), seenAt: o.seenAt,
    scoringVersion: num(o.scoringVersion) ?? 0,
    tier, strength: num(o.strength) ?? 0, risk: num(o.risk) ?? 0,
    marketCap: num(o.marketCap), fcfYieldPercent: num(o.fcfYieldPercent),
    revenueGrowthTTM: num(o.revenueGrowthTTM), evToEbitda: num(o.evToEbitda),
    impliedGrowthPct: num(o.impliedGrowthPct),
  };
}

export function parseStored(raw: string | null | undefined): SeenRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  const arr = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).records : undefined;
  if (!Array.isArray(arr)) return [];
  return arr.map(coerce).filter((r): r is SeenRecord => r !== null);
}

export function findSeen(records: SeenRecord[], ticker: string): SeenRecord | null {
  const t = ticker.toUpperCase();
  return records.find((r) => r.ticker === t) ?? null;
}

/** Replace the record for the ticker (one per ticker). */
export function upsertSeen(records: SeenRecord[], record: SeenRecord): SeenRecord[] {
  return [...records.filter((r) => r.ticker !== record.ticker), record];
}
