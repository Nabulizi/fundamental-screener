import 'server-only'; // native module + fs + Node APIs — fail loudly if bundled for the client
import type { ScanRow } from '../types';
import type { SignalTier } from '../scoring';
import { createSqliteStore } from './sqlite';

// Durable snapshot store. The interface is ASYNC even though the SQLite adapter
// is synchronous internally — so a Turso/Postgres adapter (which IS async) can
// drop in later without changing any caller. Only the local SQLite adapter is
// built now; no serverless adapter yet.

export interface SnapshotRecord {
  ticker: string;
  day: string; // YYYY-MM-DD (local), one row per ticker per day
  scoringVersion: number;
  tier: SignalTier;
  strength: number;
  risk: number;
  row: ScanRow;
  retrievedAt: string;
}

export interface Store {
  /** Idempotent per (ticker, day) — first write of the day wins. */
  putSnapshot(s: SnapshotRecord): Promise<void>;
  /** Snapshots for a ticker within the last `sinceDays`, newest day first. */
  getSnapshots(ticker: string, sinceDays: number): Promise<SnapshotRecord[]>;
  close(): void;
}

let cached: Store | null | undefined;

/**
 * The durable store, or null when it's unavailable (SNAPSHOTS_DISABLED, or a
 * SQLite init/native-module failure). Callers must treat null as "durable
 * snapshots off" — a store failure must never break scans or the detail page.
 * Memoized so we don't reopen the DB per request.
 */
export function getStore(): Store | null {
  if (cached !== undefined) return cached;
  if (process.env.SNAPSHOTS_DISABLED === '1') { cached = null; return cached; }
  try {
    cached = createSqliteStore();
  } catch (err) {
    console.warn('[store] durable snapshots disabled:', err instanceof Error ? err.message : String(err));
    cached = null;
  }
  return cached;
}

/** Test hook: reset the memoized store (e.g. after injecting a temp DB path). */
export function __resetStoreForTests(store?: Store | null): void {
  cached = store;
}
