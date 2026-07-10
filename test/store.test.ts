import { describe, it, expect, afterEach } from 'vitest';
import { createSqliteStore } from '@/lib/store/sqlite';
import type { Store, SnapshotRecord } from '@/lib/store';
import type { ScanRow } from '@/lib/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';

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

let store: Store; let dbPath: string; let tmpDir: string;
afterEach(() => {
  store?.close();
  for (const s of ['', '-wal', '-shm']) { try { rmSync(dbPath + s); } catch { /* ignore */ } }
  if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } tmpDir = ''; }
});

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

  it('creates the parent directory on a fresh path (regression: gitignored data/)', async () => {
    tmpDir = join(tmpdir(), `screener-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dbPath = join(tmpDir, 'nested', 'data', 'screener.db'); // parent dirs do NOT exist yet
    store = createSqliteStore(dbPath);                       // must mkdir, not throw
    await store.putSnapshot(snap());
    expect(await store.getSnapshots('AAPL', 3650)).toHaveLength(1);
  });

  it('imports the JSONL backup idempotently, skipping corrupt lines', async () => {
    tmpDir = join(tmpdir(), `screener-jsonl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const jsonl = join(tmpDir, 'snapshots.jsonl');
    dbPath = join(tmpDir, 'screener.db');
    writeFileSync(jsonl, [
      JSON.stringify({ date: '2026-06-01', ticker: 'AAPL', scoringVersion: 4, retrievedAt: 'x', row: row(), score: { tier: 'strong', strength: 14, risk: 2 } }),
      '{ not valid json',                                    // corrupt → skipped
      JSON.stringify({ date: '2026-06-02', ticker: 'MSFT', scoringVersion: 4, retrievedAt: 'x', row: row({ ticker: 'MSFT' }), score: { tier: 'moderate', strength: 9, risk: 3 } }),
      '',                                                    // blank → skipped
    ].join('\n'), 'utf8');

    store = createSqliteStore(dbPath, jsonl);
    expect(await store.getSnapshots('AAPL', 3650)).toHaveLength(1);
    expect((await store.getSnapshots('MSFT', 3650))[0].strength).toBe(9);
    store.close();

    // Reopen the same DB + JSONL: the meta flag makes re-import a no-op (no dupes).
    store = createSqliteStore(dbPath, jsonl);
    expect(await store.getSnapshots('AAPL', 3650)).toHaveLength(1);
  });
});
