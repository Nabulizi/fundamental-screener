# Scan-Snapshot Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append every first-fresh-of-the-day scan result (raw row + computed score + version stamps) to a local `data/snapshots.jsonl`, so scoring thresholds can eventually be validated against forward returns.

**Architecture:** One new never-throwing module (`lib/snapshotStore.ts`) owns dedup, scoring-at-write-time, and the append; the scan API route calls it once per request; a read-only script summarizes the file. Spec: `docs/specs/2026-07-03-scan-snapshots-design.md`.

**Tech Stack:** Next.js 14 / TypeScript, `node:fs/promises` (no new dependencies), Vitest.

## Global Constraints

- Branch: `feat/scan-snapshots` (already created, off `fix/scoring-correctness`).
- `recordSnapshots` must NEVER throw or reject — a snapshot failure must never fail a scan.
- No live network in tests (repo rule); filesystem in tests is fine (use a per-test temp dir).
- Never mutate or coerce `ScanRow` values — store rows exactly as received (missing ≠ zero is load-bearing).
- Before claiming done: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `SCORING_VERSION` constant

**Files:**
- Modify: `lib/scoring.ts` (top constants block, near `MAX_STRENGTH`)
- Test: `test/scoring.test.ts` (append a describe block at the end)

**Interfaces:**
- Produces: `export const SCORING_VERSION = 3` from `@/lib/scoring` (consumed by Task 2).

- [ ] **Step 1: Write the failing test** — append to `test/scoring.test.ts`:

```ts
describe('SCORING_VERSION', () => {
  it('is a positive integer (stamped into scan snapshots)', () => {
    expect(Number.isInteger(SCORING_VERSION)).toBe(true);
    expect(SCORING_VERSION).toBeGreaterThanOrEqual(3);
  });
});
```

and add `SCORING_VERSION` to the existing `from '@/lib/scoring'` import list in that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scoring.test.ts 2>&1 | grep -E "SCORING_VERSION|Tests "`
Expected: FAIL (`SCORING_VERSION` is not exported).

- [ ] **Step 3: Write minimal implementation** — in `lib/scoring.ts`, directly below the `RISK_FLOOR` constant:

```ts
/**
 * Methodology version stamped into scan snapshots (lib/snapshotStore.ts).
 * BUMP THIS whenever criteria, thresholds, or weights change — it separates
 * methodology eras in the longitudinal record so v3 scores are never compared
 * naively against scores produced by different rules.
 */
export const SCORING_VERSION = 3;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scoring.test.ts 2>&1 | tail -3`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring.ts test/scoring.test.ts
git commit -m "feat(scoring): SCORING_VERSION constant for snapshot stamping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/snapshotStore.ts` — core write + dedup

**Files:**
- Create: `lib/snapshotStore.ts`
- Create: `test/snapshotStore.test.ts`

**Interfaces:**
- Consumes: `scoreRow`, `SCORING_VERSION`, types `ScoredRow` from `@/lib/scoring`; `ScanRow` from `@/lib/types`.
- Produces: `recordSnapshots(rows: ScanRow[], opts?: SnapshotOptions): Promise<number>`, `SNAPSHOT_SCHEMA_VERSION = 1`, and `type SnapshotCache` (consumed by Tasks 3–4).

- [ ] **Step 1: Write the failing tests** — create `test/snapshotStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/snapshotStore.test.ts 2>&1 | tail -5`
Expected: FAIL — cannot resolve `@/lib/snapshotStore`.

- [ ] **Step 3: Write the implementation** — create `lib/snapshotStore.ts`:

```ts
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScanRow } from './types';
import { scoreRow, SCORING_VERSION, type ScoredRow } from './scoring';

// Append-only JSONL scan history. One line per ticker per local calendar day
// (first fresh result wins). See docs/specs/2026-07-03-scan-snapshots-design.md.

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

/**
 * Append the first fresh (non-cached) result of the day for each ticker.
 * Returns how many lines were written. NEVER throws — a snapshot failure must
 * never fail a scan. Disable entirely with SNAPSHOTS_DISABLED=1.
 */
export async function recordSnapshots(rows: ScanRow[], opts: SnapshotOptions = {}): Promise<number> {
  try {
    if (process.env.SNAPSHOTS_DISABLED === '1') return 0;
    const filePath = opts.filePath ?? DEFAULT_FILE;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/snapshotStore.test.ts 2>&1 | tail -3`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/snapshotStore.ts test/snapshotStore.test.ts
git commit -m "feat(snapshots): JSONL snapshot store with per-day dedup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: snapshot store resilience (restart, corruption, disable, failure)

**Files:**
- Modify: `test/snapshotStore.test.ts` (append a describe block)
- Modify (only if a test fails): `lib/snapshotStore.ts`

**Interfaces:**
- Consumes: everything from Task 2. No new exports.

- [ ] **Step 1: Write the tests** — append to `test/snapshotStore.test.ts` (also add `vi` to the vitest import and `writeFile` to the `node:fs/promises` import):

```ts
describe('recordSnapshots — resilience', () => {
  it('rebuilds the seen-set from the file after a restart (fresh cache)', async () => {
    await recordSnapshots([freshRow('AAPL')], { filePath: file(), now: day1, cache: new Map() });
    // New cache = simulated server restart; dedup must come from the file.
    const after = await recordSnapshots([freshRow('AAPL')], { filePath: file(), now: day1, cache: new Map() });
    expect(after).toBe(0);
    expect(await lines()).toHaveLength(1);
  });

  it('tolerates corrupt lines in an existing file', async () => {
    const good = JSON.stringify({ v: 1, date: '2026-07-03', ticker: 'AAPL', scoringVersion: 3, row: {}, score: {} });
    await writeFile(file(), `not json at all\n${good}\n`, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const written = await recordSnapshots([freshRow('AAPL'), freshRow('MSFT')], { filePath: file(), now: day1, cache: new Map() });
    expect(written).toBe(1); // AAPL deduped from the good line; MSFT written
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('corrupt'));
    warn.mockRestore();
  });

  it('is a no-op when SNAPSHOTS_DISABLED=1', async () => {
    vi.stubEnv('SNAPSHOTS_DISABLED', '1');
    const written = await recordSnapshots([freshRow('AAPL')], { filePath: file(), now: day1, cache: new Map() });
    vi.unstubAllEnvs();
    expect(written).toBe(0);
  });

  it('warns and returns 0 on append failure — never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const written = await recordSnapshots([freshRow('AAPL')], {
      filePath: file(), now: day1, cache: new Map(),
      appendFileImpl: async () => { throw new Error('disk full'); },
    });
    expect(written).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/snapshotStore.test.ts 2>&1 | tail -4`
Expected: all 8 pass (Task 2's implementation already covers these paths; if any fails, fix `lib/snapshotStore.ts` until green — do not weaken the assertions).

- [ ] **Step 3: Commit**

```bash
git add test/snapshotStore.test.ts lib/snapshotStore.ts
git commit -m "test(snapshots): restart, corruption, disable, and failure paths

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: wire the scan route + gitignore

**Files:**
- Modify: `app/api/scan/route.ts` (imports block + the `try` block around line 71–78)
- Modify: `.gitignore` (append one line)

**Interfaces:**
- Consumes: `recordSnapshots` from `@/lib/snapshotStore` (Task 2 signature, called with default options).

- [ ] **Step 1: Add the import** — in `app/api/scan/route.ts`, after the existing `scanTickers` import:

```ts
import { recordSnapshots } from '@/lib/snapshotStore';
```

- [ ] **Step 2: Add the call** — in the same file, the existing code reads:

```ts
  try {
    const result = await scanTickers(parsed.valid, provider, { ttlSeconds, refresh: body.refresh === true });
```

Change it to:

```ts
  try {
    const result = await scanTickers(parsed.valid, provider, { ttlSeconds, refresh: body.refresh === true });
    // Longitudinal scan history (first fresh result per ticker per day).
    // recordSnapshots never throws; a snapshot failure never fails the scan.
    await recordSnapshots(result.rows);
```

- [ ] **Step 3: Append to `.gitignore`:**

```
# local scan-snapshot history (research data, machine-local)
/data/
```

- [ ] **Step 4: Verify nothing broke**

Run: `npm test 2>&1 | grep "Tests " && npm run typecheck && npm run build 2>&1 | grep -E "✓ Compiled|error"`
Expected: all tests pass, typecheck silent, build compiles.

- [ ] **Step 5: Commit**

```bash
git add app/api/scan/route.ts .gitignore
git commit -m "feat(snapshots): record scan history from the scan route

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: summary script

**Files:**
- Create: `scripts/snapshots-summary.mjs`
- Modify: `package.json` (one line in `"scripts"`)

**Interfaces:**
- Consumes: the JSONL line format from Task 2 (fields `date`, `ticker`, `scoringVersion`, `score.{strength,risk,tier}`).

- [ ] **Step 1: Create `scripts/snapshots-summary.mjs`:**

```js
#!/usr/bin/env node
// Read-only summary of data/snapshots.jsonl (or a path passed as argv[2]).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const file = process.argv[2] ?? path.join(process.cwd(), 'data', 'snapshots.jsonl');

let raw;
try {
  raw = await readFile(file, 'utf8');
} catch {
  console.log(`No snapshots yet (${file} not found). Run a scan first.`);
  process.exit(0);
}

const byTicker = new Map();
const days = new Set();
const versions = new Set();
let total = 0;
let corrupt = 0;

for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  let s;
  try { s = JSON.parse(line); } catch { corrupt += 1; continue; }
  total += 1;
  days.add(s.date);
  versions.add(s.scoringVersion);
  const prev = byTicker.get(s.ticker);
  if (!prev || s.date >= prev.date) {
    byTicker.set(s.ticker, {
      count: (prev?.count ?? 0) + 1,
      date: s.date,
      strength: s.score?.strength ?? '-',
      risk: s.score?.risk ?? '-',
      tier: s.score?.tier ?? '-',
    });
  } else {
    prev.count += 1;
  }
}

const dates = [...days].sort();
const vs = [...versions].sort().join(', v');
console.log(
  `${total} snapshot(s) · ${days.size} day(s) · ${dates[0] ?? '—'} → ${dates.at(-1) ?? '—'} · scoring v${vs}` +
  (corrupt ? ` · ${corrupt} corrupt line(s) skipped` : '')
);
console.log('\nTicker    Count  Latest      Strength  Risk  Tier');
for (const [t, i] of [...byTicker.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(
    `${t.padEnd(9)} ${String(i.count).padEnd(6)} ${i.date}  ${String(i.strength).padEnd(9)} ${String(i.risk).padEnd(5)} ${i.tier}`
  );
}
```

- [ ] **Step 2: Add the npm script** — in `package.json` `"scripts"`, after the `"probe"` entry:

```json
    "snapshots": "node scripts/snapshots-summary.mjs",
```

- [ ] **Step 3: Verify both paths by hand**

Run: `npm run snapshots`
Expected: `No snapshots yet (...) Run a scan first.` (no `data/` yet).

Run: `mkdir -p /tmp/snaptest && printf '%s\n' '{"v":1,"date":"2026-07-03","ticker":"AAPL","scoringVersion":3,"row":{},"score":{"strength":13,"risk":3,"tier":"strong"}}' > /tmp/snaptest/s.jsonl && node scripts/snapshots-summary.mjs /tmp/snaptest/s.jsonl`
Expected: header line `1 snapshot(s) · 1 day(s) · 2026-07-03 → 2026-07-03 · scoring v3` and an `AAPL` table row.

- [ ] **Step 4: Commit**

```bash
git add scripts/snapshots-summary.mjs package.json
git commit -m "feat(snapshots): npm run snapshots summary script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: docs + full verification

**Files:**
- Modify: `README.md` (new section after "Reliability")
- Modify: `CLAUDE.md` (Architecture list + Gotchas)

**Interfaces:** none (documentation).

- [ ] **Step 1: README** — insert after the "Reliability" section:

```markdown
## Scan history (snapshots)

Every scan appends the **first fresh result per ticker per day** to a local
`data/snapshots.jsonl` (git-ignored): the raw provider row, the computed
score, and version stamps (`scoringVersion`, schema `v`). This builds the
longitudinal record needed to eventually validate scoring thresholds against
forward returns. `npm run snapshots` prints a summary. Set
`SNAPSHOTS_DISABLED=1` to turn recording off.
```

- [ ] **Step 2: CLAUDE.md** — in the Architecture bullet list, after the `lib/scoring.ts` entry, add:

```markdown
- `lib/snapshotStore.ts` — append-only JSONL scan history (`data/snapshots.jsonl`,
  git-ignored): first fresh result per ticker per local day, raw row + score
  computed at write time + `SCORING_VERSION` stamp. `recordSnapshots` NEVER
  throws; disable with `SNAPSHOTS_DISABLED=1`. Summary: `npm run snapshots`.
```

And in the Gotchas section, add:

```markdown
- **Bump `SCORING_VERSION`** (`lib/scoring.ts`) whenever criteria, thresholds,
  or weights change — snapshots stamp it to separate methodology eras. Bump
  `SNAPSHOT_SCHEMA_VERSION` (`lib/snapshotStore.ts`) only if the JSONL line
  format changes.
```

- [ ] **Step 3: Full gates**

Run: `npm test 2>&1 | grep "Tests " && npm run typecheck && npm run lint && npm run build 2>&1 | grep -E "✓ Compiled|error"`
Expected: all pass, no lint warnings.

- [ ] **Step 4: Manual end-to-end check** (needs `FINNHUB_API_KEY` in `.env.local`; in the agent sandbox also `NODE_TLS_REJECT_UNAUTHORIZED=0`)

Run `npm run dev`, scan 2–3 tickers in the browser, then:
`cat data/snapshots.jsonl | wc -l` → one line per ticker; re-scan the same tickers → line count unchanged; `npm run snapshots` → sensible table.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(snapshots): README + CLAUDE.md conventions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
