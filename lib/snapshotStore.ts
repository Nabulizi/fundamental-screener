import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScanRow } from './types';
import { scoreRow, SCORING_VERSION, type ScoredRow } from './scoring';

// Append-only JSONL scan history. One line per ticker per local calendar day
// (first fresh result wins). See docs/specs/2026-07-03-scan-snapshots-design.md.
// Concurrent calls against the SAME file path are serialized through a per-file
// in-flight promise chain (fileLocks) so that cold-cache rebuilds and dedup
// checks never race. Distinct file paths are independent and do not block each
// other.

/** Bump if the LINE FORMAT below ever changes (scoring changes bump SCORING_VERSION instead). */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Per-file memo of which tickers are already recorded for a given date. */
export type SnapshotCache = Map<string, { date: string; tickers: Set<string> }>;

export interface SnapshotOptions {
  /** Defaults to <repo>/data/snapshots.jsonl. */
  filePath?: string;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable seen-set cache for tests (a fresh Map simulates a server restart). */
  cache?: SnapshotCache;
  /** Injectable fs for failure-path tests. */
  appendFileImpl?: typeof appendFile;
  readFileImpl?: typeof readFile;
  mkdirImpl?: typeof mkdir;
}

const DEFAULT_FILE = path.join(process.cwd(), 'data', 'snapshots.jsonl');
const defaultCache: SnapshotCache = new Map();

/** Per-file mutex: serializes concurrent recordSnapshots calls to the same path. */
const fileLocks = new Map<string, Promise<unknown>>();

function localDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The "what the tool said at the time" record — everything but the row itself. */
function toScoreRecord(s: ScoredRow) {
  return {
    strength: s.strengthScore,
    risk: s.riskScore,
    tier: s.tier,
    coverage: s.coverage,
    flags: s.flags,
    breakdown: s.breakdown,
  };
}

async function seenTickers(filePath: string, date: string, opts: SnapshotOptions): Promise<Set<string>> {
  const cache = opts.cache ?? defaultCache;
  const hit = cache.get(filePath);
  if (hit && hit.date === date) return hit.tickers;

  const tickers = new Set<string>();
  const read = opts.readFileImpl ?? readFile;
  try {
    const raw = await read(filePath, 'utf8');
    let corrupt = 0;
    for (const line of String(raw).split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { date?: unknown; ticker?: unknown };
        if (parsed.date === date && typeof parsed.ticker === 'string') tickers.add(parsed.ticker);
      } catch {
        corrupt += 1;
      }
    }
    if (corrupt > 0) console.warn(`[snapshots] skipped ${corrupt} corrupt line(s) while reading ${filePath}`);
  } catch (err) {
    // Missing file just means no history yet; anything else propagates to the
    // outer never-throw guard in recordSnapshots.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  cache.set(filePath, { date, tickers });
  return tickers;
}

async function doRecord(rows: ScanRow[], opts: SnapshotOptions, filePath: string): Promise<number> {
  try {
    if (process.env.SNAPSHOTS_DISABLED === '1') return 0;
    const nowFn = opts.now ?? (() => new Date());
    const date = localDate(nowFn());
    const seen = await seenTickers(filePath, date, opts);

    const fresh = rows.filter((r) => r.cached === false && !seen.has(r.ticker));
    if (fresh.length === 0) return 0;

    const payload = fresh
      .map((row) =>
        JSON.stringify({
          v: SNAPSHOT_SCHEMA_VERSION,
          date,
          retrievedAt: row.retrievedAt,
          ticker: row.ticker,
          scoringVersion: SCORING_VERSION,
          row,
          score: toScoreRecord(scoreRow(row)),
        }) + '\n'
      )
      .join('');

    await (opts.mkdirImpl ?? mkdir)(path.dirname(filePath), { recursive: true });
    await (opts.appendFileImpl ?? appendFile)(filePath, payload, 'utf8');
    for (const r of fresh) seen.add(r.ticker);
    return fresh.length;
  } catch (err) {
    console.warn(`[snapshots] failed to record: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/**
 * Append the first fresh (non-cached) result of the day for each ticker.
 * Returns how many lines were written. NEVER throws — a snapshot failure must
 * never fail a scan. Disable entirely with SNAPSHOTS_DISABLED=1.
 *
 * Concurrent calls for the same file path are serialized through a per-file
 * in-flight promise chain so that cold-cache rebuilds and dedup checks never
 * race. Calls for distinct file paths are fully independent.
 */
export function recordSnapshots(rows: ScanRow[], opts: SnapshotOptions = {}): Promise<number> {
  const filePath = opts.filePath ?? DEFAULT_FILE;
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  const run = prev.then(() => doRecord(rows, opts, filePath));
  fileLocks.set(filePath, run.catch(() => {}));
  return run;
}
