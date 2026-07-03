import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ScanRow } from '@/lib/types';
import { recordSnapshots, SNAPSHOT_SCHEMA_VERSION, type SnapshotCache } from '@/lib/snapshotStore';
import { SCORING_VERSION } from '@/lib/scoring';

function freshRow(ticker: string, overrides: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker, companyName: `${ticker} Inc`, industry: 'Software', marketCap: 1_000_000_000,
    currency: 'USD', week52Low: 10, week52High: 20, trailingPE: 20, forwardPE: 15,
    dividendYieldPercent: 1, ytdReturn: 5, fcfYieldPercent: 8, revenueGrowthTTM: 12,
    debtToEquity: 0.5, evToEbitda: 10, currentPrice: 15, rangePosition: 0.5,
    cached: false, retrievedAt: '2026-07-03T14:00:00.000Z', ...overrides,
  };
}

// No trailing Z: parsed as LOCAL time, so the derived date is 2026-07-03 in any TZ.
const day1 = () => new Date('2026-07-03T15:00:00');
const day2 = () => new Date('2026-07-04T15:00:00');

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'snapshots-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const file = () => path.join(dir, 'snapshots.jsonl');

async function lines(): Promise<Record<string, unknown>[]> {
  const raw = await readFile(file(), 'utf8');
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

describe('recordSnapshots — core', () => {
  it('writes one schema-complete line per fresh row', async () => {
    const cache: SnapshotCache = new Map();
    const written = await recordSnapshots([freshRow('AAPL'), freshRow('MSFT')], { filePath: file(), now: day1, cache });
    expect(written).toBe(2);
    const all = await lines();
    expect(all).toHaveLength(2);
    const first = all[0] as { v: number; date: string; ticker: string; scoringVersion: number; retrievedAt: string; row: ScanRow; score: { strength: number; risk: number; tier: string; coverage: { covered: number } } };
    expect(first.v).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(first.date).toBe('2026-07-03');
    expect(first.ticker).toBe('AAPL');
    expect(first.scoringVersion).toBe(SCORING_VERSION);
    expect(first.retrievedAt).toBe('2026-07-03T14:00:00.000Z');
    expect(first.row.fcfYieldPercent).toBe(8);
    expect(typeof first.score.strength).toBe('number');
    expect(typeof first.score.risk).toBe('number');
    expect(['strong', 'moderate', 'weak']).toContain(first.score.tier);
    expect(first.score.coverage.covered).toBeGreaterThan(0);
  });

  it('skips a same-day duplicate ticker (first fresh of the day wins)', async () => {
    const cache: SnapshotCache = new Map();
    await recordSnapshots([freshRow('AAPL')], { filePath: file(), now: day1, cache });
    const second = await recordSnapshots([freshRow('AAPL', { currentPrice: 16 })], { filePath: file(), now: day1, cache });
    expect(second).toBe(0);
    expect(await lines()).toHaveLength(1);
  });

  it('records the same ticker again on the next day', async () => {
    const cache: SnapshotCache = new Map();
    await recordSnapshots([freshRow('AAPL')], { filePath: file(), now: day1, cache });
    const next = await recordSnapshots([freshRow('AAPL')], { filePath: file(), now: day2, cache });
    expect(next).toBe(1);
    expect(await lines()).toHaveLength(2);
  });

  it('never records cached rows', async () => {
    const written = await recordSnapshots([freshRow('AAPL', { cached: true })], { filePath: file(), now: day1, cache: new Map() });
    expect(written).toBe(0);
  });
});
