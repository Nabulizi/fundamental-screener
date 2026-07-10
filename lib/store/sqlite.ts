import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Store, SnapshotRecord } from './index';
import type { SignalTier } from '../scoring';

// SQLite adapter (local/self-hosted). Sync internally (better-sqlite3), wrapped
// in the async Store interface. better-sqlite3 is required LAZILY via
// createRequire so a native-module load failure surfaces as a caught exception
// in getStore() (→ durable snapshots disabled) rather than a module-load crash.

interface Stmt {
  run(...params: unknown[]): unknown;
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}
interface Db {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  pragma(s: string): void;
  transaction<T>(fn: (arg: T) => void): (arg: T) => void;
  close(): void;
}

interface SnapshotRow {
  ticker: string; day: string; scoring_version: number;
  tier: string; strength: number; risk: number; row_json: string; retrieved_at: string;
}

function fromDb(r: SnapshotRow): SnapshotRecord {
  return {
    ticker: r.ticker, day: r.day, scoringVersion: r.scoring_version,
    tier: r.tier as SignalTier, strength: r.strength, risk: r.risk,
    row: JSON.parse(r.row_json), retrievedAt: r.retrieved_at,
  };
}

export function createSqliteStore(dbPath?: string): Store {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3') as new (p: string) => Db;
  const db = new Database(dbPath ?? path.join(process.cwd(), 'data', 'screener.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS snapshots (
    ticker TEXT NOT NULL, day TEXT NOT NULL, scoring_version INTEGER NOT NULL,
    tier TEXT NOT NULL, strength INTEGER NOT NULL, risk INTEGER NOT NULL,
    row_json TEXT NOT NULL, retrieved_at TEXT NOT NULL,
    PRIMARY KEY (ticker, day)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);

  const insert = db.prepare(`INSERT OR IGNORE INTO snapshots
    (ticker, day, scoring_version, tier, strength, risk, row_json, retrieved_at)
    VALUES (@ticker, @day, @scoringVersion, @tier, @strength, @risk, @rowJson, @retrievedAt)`);
  const selectSince = db.prepare(`SELECT * FROM snapshots WHERE ticker = ? AND day >= ? ORDER BY day DESC`);

  const put = (s: SnapshotRecord) => insert.run({
    ticker: s.ticker.toUpperCase(), day: s.day, scoringVersion: s.scoringVersion,
    tier: s.tier, strength: s.strength, risk: s.risk,
    rowJson: JSON.stringify(s.row), retrievedAt: s.retrievedAt,
  });

  // One-time, idempotent import of the pre-existing JSONL history (kept on disk
  // as a backup — never deleted). INSERT OR IGNORE makes a re-run a no-op.
  importJsonlOnce(db, put, dbPath);

  return {
    async putSnapshot(s) { put(s); },
    async getSnapshots(ticker, sinceDays) {
      const since = localDay(new Date(Date.now() - sinceDays * 86_400_000));
      return (selectSince.all(ticker.toUpperCase(), since) as SnapshotRow[]).map(fromDb);
    },
    close() { db.close(); },
  };
}

function importJsonlOnce(db: Db, put: (s: SnapshotRecord) => void, dbPath?: string) {
  if (dbPath && dbPath !== path.join(process.cwd(), 'data', 'screener.db')) return; // skip for temp test DBs
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get('jsonl_imported');
  if (done) return;
  try {
    const raw = readFileSync(path.join(process.cwd(), 'data', 'snapshots.jsonl'), 'utf8');
    const records: SnapshotRecord[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line) as { date?: string; ticker?: string; scoringVersion?: number; retrievedAt?: string; row?: ScanRowLike; score?: { tier?: string; strength?: number; risk?: number } };
        if (typeof p.ticker !== 'string' || typeof p.date !== 'string' || !p.row || !p.score) continue;
        records.push({
          ticker: p.ticker, day: p.date, scoringVersion: p.scoringVersion ?? 0,
          tier: (p.score.tier ?? 'weak') as SignalTier, strength: p.score.strength ?? 0, risk: p.score.risk ?? 0,
          row: p.row as SnapshotRecord['row'], retrievedAt: p.retrievedAt ?? '',
        });
      } catch { /* skip corrupt line */ }
    }
    const tx = db.transaction((rs: SnapshotRecord[]) => { for (const r of rs) put(r); });
    tx(records);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[store] JSONL import skipped:', err instanceof Error ? err.message : String(err));
    }
  }
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('jsonl_imported', '1');
}

type ScanRowLike = SnapshotRecord['row'];

function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
