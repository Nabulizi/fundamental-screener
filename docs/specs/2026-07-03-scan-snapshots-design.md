# Scan-Snapshot Persistence — Design

**Date:** 2026-07-03
**Status:** Approved (brainstormed with owner; approach A of three considered)
**Branch:** `feat/scan-snapshots` (off `fix/scoring-correctness`; rebase onto `main` after PR #5 merges; separate PR)

## Purpose

Every scoring threshold in `lib/scoring.ts` (conversion bands 0.5/0.7, coverage bands 2×/6×, ±3pp acceleration, tier cut-offs, the ×3/×2/×1 weights) is an educated prior, not a measured fact. The only way to ever measure them is a longitudinal record: what data the tool saw, what it said, and when. This feature writes that record. Analysis of it (forward returns vs. tier, threshold calibration) is explicitly **out of scope** — months of history must accumulate first.

## Decisions (made with the owner)

1. **Local only.** The app runs as `npm run dev` on one machine; no deployment exists or is planned. Snapshots go to a local file. (If deployment ever happens, the store is one small module to swap.)
2. **Auto-capture, one fresh snapshot per ticker per local calendar day.** No button to remember; no intra-day noise. The **first fresh (non-cached) result of the day wins**; later scans and `refresh` fetches the same day are skipped.
3. **Collect only.** No UI changes. One read-only summary script.

## Storage format

Append-only JSONL at `data/snapshots.jsonl` (`data/` git-ignored, created on demand). One line per ticker-snapshot:

```json
{"v":1, "date":"2026-07-03", "retrievedAt":"2026-07-03T14:22:07.113Z",
 "ticker":"DELL", "scoringVersion":3,
 "row":{ "...": "full raw ScanRow, including currentPrice" },
 "score":{"strength":13,"risk":3,"tier":"strong",
          "coverage":{"covered":12,"applicable":12,"fraction":1},
          "flags":{"...":"RowFlags"}, "breakdown":{"...":"ScoreBreakdown"}}}
```

| Field | Meaning |
|---|---|
| `v` | Snapshot **schema** version (starts at 1). Bumped if this line format ever changes. |
| `date` | Local calendar date (`YYYY-MM-DD`, server-local time). The dedup key together with `ticker`. |
| `retrievedAt` | The row's provider-fetch timestamp (already on `ScanRow`). |
| `scoringVersion` | New exported `SCORING_VERSION` constant in `lib/scoring.ts`, starting at `3` (the v3 framework on the PR branch). **Bumped whenever criteria, thresholds, or weights change** — convention recorded in CLAUDE.md. Distinguishes methodology eras in later analysis. |
| `row` | The full raw `ScanRow` as returned by the provider layer. `currentPrice` is what makes forward-return analysis possible. |
| `score` | `scoreRow(row)` output computed server-side **at write time**: what the tool said then, immune to later code changes. Scores are also recomputable from `row` with any code version — storing both costs nothing and preserves both views. |

Rationale for JSONL over SQLite / browser storage: zero dependencies, append-only (crash-safe), greppable, readable from any future analysis script; at ≤20 tickers/day it grows ~5 MB/year. SQLite is a ten-line migration later if ever wanted; browser storage would trap research data in one profile.

## New module: `lib/snapshotStore.ts`

Public API (single function):

```ts
recordSnapshots(rows: ScanRow[], opts?: SnapshotOptions): Promise<number>
```

- Filters to `cached === false` rows, drops tickers already recorded for today, scores each remaining row via `scoreRow` (the store owns the scoring call — the route just passes rows), appends the lines in **one** `fs.appendFile` call, returns the count written.
- **Lazy seen-set:** on first use, reads the file if present and builds an in-memory `Set` of `date:ticker` keys **for today only**. Restart-safe by construction; no index file. Corrupt lines are skipped with a warning (same tolerance stance as `lib/watchlists.ts`).
- **Never throws from the public API.** Disk full, permissions, serialization — caught and `console.warn`ed. A snapshot failure must never fail a scan.
- **Injectable dependencies** via `SnapshotOptions` (`filePath`, `now()` clock, fs functions), following the `RetryOptions` pattern in `lib/retry.ts`, so tests run against a temp directory with a fake clock. Defaults: `data/snapshots.jsonl` under the repo root, real clock, real fs.
- **Escape hatch:** `SNAPSHOTS_DISABLED=1` env var makes `recordSnapshots` a no-op returning 0. No other configuration.

## Wiring

One call in `app/api/scan/route.ts` (`runtime = 'nodejs'`, so `fs` is available): after `scanTickers` resolves and before the response is built, `await recordSnapshots(result.rows)` inside the store's own never-throw guarantee. The client scans one ticker per POST (`lib/clientScan.ts`), so this runs per ticker; the dedup set makes repeat calls free. The response is unchanged — snapshots are invisible to the client.

## Summary script: `scripts/snapshots-summary.mjs`

`npm run snapshots` (new package.json script). Read-only; prints:

- total snapshots, distinct days, date range, scoring versions present;
- per-ticker table: snapshot count, latest date, latest strength/risk/tier.

Tolerates a missing file (prints "no snapshots yet") and skips corrupt lines with a count.

## Testing

Vitest unit tests for the store (temp dir + injected clock; no mocking of the module under test):

1. Writes one line per fresh row with the exact schema fields (`v`, `date`, `ticker`, `scoringVersion`, `row`, `score`).
2. Same-day duplicate ticker → skipped (returns 0 on second call).
3. Next-day (advanced clock) same ticker → recorded.
4. `cached: true` rows → never recorded.
5. Seen-set rebuild: a fresh store instance pointed at an existing file still dedups today's tickers.
6. Corrupt line in existing file → warned, skipped, store still works.
7. `SNAPSHOTS_DISABLED=1` → no-op.
8. Append failure (injected failing fs) → warns, returns 0, does not throw.

Route wiring (one line) is verified manually: `npm run dev`, scan a watchlist, inspect `data/snapshots.jsonl`, re-scan and confirm no duplicates.

## Docs & housekeeping

- `.gitignore`: add `data/`.
- README: short "Scan history" section (what's recorded, where, the env escape hatch, `npm run snapshots`).
- CLAUDE.md: snapshot store convention + the `SCORING_VERSION` bump rule ("bump when criteria/thresholds/weights change").

## Out of scope (deliberate)

- Any analysis, backtesting, or forward-return computation (needs accumulated history first).
- Any UI (history views, score-change deltas) — revisit once data exists.
- Rotation/compaction (irrelevant at ~5 MB/year), SQLite, deployment-ready storage adapters.
