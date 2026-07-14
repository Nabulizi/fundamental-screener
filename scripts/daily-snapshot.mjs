#!/usr/bin/env node
// Scan a fixed universe once so the snapshot store accumulates a daily
// point-in-time record (data/snapshots.jsonl + data/screener.db). Snapshots
// keep only the FIRST fresh result per ticker per local day, so running this
// more than once a day is harmless.
//
// It goes through the real /api/scan route (all provider, scoring, and
// snapshot logic stays in one place). If no server is running it starts
// `next start` on an ephemeral port for the duration (building first if
// needed).
//
// Universe: SNAPSHOT_TICKERS env (comma/space separated) or data/universe.txt
// (one ticker per line, `#` comments allowed).
//
// Usage:  node scripts/daily-snapshot.mjs
// Env:    SNAPSHOT_BASE_URL  use an already-running server (skip spawn)
//         SNAPSHOT_TICKERS   inline universe, overrides data/universe.txt

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const configuredMax = Number(process.env.MAX_TICKERS);
const CHUNK = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.floor(configuredMax) : 20;
const PORT = 4321;
// Invoke Next through THIS node binary and the repo-local bin — under launchd
// there is no shell profile, so neither `npx` nor `/usr/bin/env node` resolves.
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

async function loadUniverse() {
  const inline = process.env.SNAPSHOT_TICKERS;
  if (inline?.trim()) return inline.split(/[\s,]+/).filter(Boolean);
  const file = path.join(ROOT, 'data', 'universe.txt');
  try {
    const raw = await readFile(file, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean);
  } catch {
    console.error(
      `No universe configured. Create ${file} (one ticker per line) or set SNAPSHOT_TICKERS.`
    );
    process.exit(2);
  }
}

async function serverUp(base) {
  try {
    const res = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: '' }),
      signal: AbortSignal.timeout(5_000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function scanChunk(base, tickers) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tickers }),
      signal: AbortSignal.timeout(120_000)
    });
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Math.max(1, Number(res.headers.get('retry-after')) || 60);
      console.log(`[daily-snapshot] provider budget reached — retrying chunk in ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1_000));
      continue;
    }
    if (!res.ok) throw new Error(`scan HTTP ${res.status}`);
    const out = await res.json();
    if (out.meta?.limited) throw new Error(`server truncated a ${tickers.length}-ticker chunk at ${out.meta.maxTickers}`);
    return out;
  }
  throw new Error('scan retry exhausted');
}

const universe = await loadUniverse();
console.log(`[daily-snapshot] ${new Date().toISOString()} universe=${universe.length} tickers`);

let base = process.env.SNAPSHOT_BASE_URL ?? null;
let child = null;

if (!base || !(await serverUp(base))) {
  base = `http://localhost:${PORT}`;
  if (!(await serverUp(base))) {
    if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
      console.log('[daily-snapshot] no production build — running next build…');
      execFileSync(process.execPath, [NEXT_BIN, 'build'], { cwd: ROOT, stdio: 'inherit' });
    }
    console.log(`[daily-snapshot] starting next start on :${PORT}…`);
    child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    const deadline = Date.now() + 60_000;
    while (!(await serverUp(base))) {
      if (Date.now() > deadline) {
        child.kill();
        console.error('[daily-snapshot] server did not become ready in 60s');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

let rows = 0;
let errors = 0;
let providerCalls = 0;
let snapshotsRecorded = 0;
let failedChunks = 0;

try {
  for (let i = 0; i < universe.length; i += CHUNK) {
    const chunk = universe.slice(i, i + CHUNK);
    try {
      const out = await scanChunk(base, chunk);
      rows += out.rows?.length ?? 0;
      errors += out.errors?.length ?? 0;
      providerCalls += out.telemetry?.providerCalls ?? 0;
      snapshotsRecorded += out.telemetry?.snapshotsRecorded ?? 0;
      for (const e of out.errors ?? []) console.error(`[daily-snapshot]   ${e.ticker}: ${e.code}`);
    } catch (err) {
      failedChunks += 1;
      console.error(`[daily-snapshot] chunk ${chunk[0]}… failed: ${err.message}`);
    }
    // Pace chunks: the scan budget is 30 requests/min per client.
    if (i + CHUNK < universe.length) await new Promise((r) => setTimeout(r, 3_000));
  }
} finally {
  child?.kill();
}

console.log(
  `[daily-snapshot] done: ${rows} rows, ${snapshotsRecorded} snapshots recorded, ${errors} ticker errors, ${failedChunks} failed chunks, ${providerCalls} provider calls`
);
process.exit(snapshotsRecorded > 0 && failedChunks === 0 ? 0 : 1);
