import { describe, it, expect, afterEach } from 'vitest';
import { createSqliteStore } from '@/lib/store/sqlite';
import type { Store, SnapshotRecord } from '@/lib/store';
import type { ScanRow } from '@/lib/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

function row(over: Partial<ScanRow> = {}): ScanRow {
  return {
    ticker: 'AAPL', companyName: 'Apple', industry: 'Tech', marketCap: 1e9, currency: 'USD',
    week52Low: null, week52High: null, trailingPE: null, forwardPE: null, dividendYieldPercent: null,
    ytdReturn: null, fcfYieldPercent: 5, revenueGrowthTTM: 10, debtToEquity: null, evToEbitda: 15,
    retrievedAt: '2026-01-01T00:00:00Z', ...over,
  };
}
const snap = (over: Partial<SnapshotRecord> = {}): SnapshotRecord => ({
  ticker: 'AAPL', day: '2026-06-01', scoringVersion: 4, tier: 'moderate', strength: 8, risk: 4,
  row: row(), retrievedAt: '2026-06-01T00:00:00Z', ...over,
});

let store: Store; let dbPath: string;
afterEach(() => { store?.close(); for (const s of ['', '-wal', '-shm']) { try { rmSync(dbPath + s); } catch { /* ignore */ } } });

describe('sqlite store', () => {
  it('putSnapshot is idempotent per (ticker, day); getSnapshots windows and orders newest-first', async () => {
    dbPath = join(tmpdir(), `screener-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = createSqliteStore(dbPath);
    await store.putSnapshot(snap({ day: '2026-06-01', strength: 8 }));
    await store.putSnapshot(snap({ day: '2026-06-01', strength: 12 })); // same (ticker, day) → ignored
    await store.putSnapshot(snap({ day: '2026-06-15', strength: 9 }));

    const all = await store.getSnapshots('aapl', 3650);
    expect(all).toHaveLength(2);
    expect(all[0].day).toBe('2026-06-15');                       // newest first
    expect(all.find((s) => s.day === '2026-06-01')!.strength).toBe(8); // first write won
    expect(await store.getSnapshots('AAPL', 1)).toHaveLength(0); // old snapshots outside a 1-day window
  });

  it('round-trips the ScanRow', async () => {
    dbPath = join(tmpdir(), `screener-${Date.now()}-r.db`);
    store = createSqliteStore(dbPath);
    await store.putSnapshot(snap({ row: row({ marketCap: 3e12, fcfYieldPercent: 6 }) }));
    const [s] = await store.getSnapshots('AAPL', 3650);
    expect(s.row.marketCap).toBe(3e12);
    expect(s.row.fcfYieldPercent).toBe(6);
    expect(s.tier).toBe('moderate');
  });
});
