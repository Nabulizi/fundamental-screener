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
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const CHUNK = 20; // stay within MAX_TICKERS per request
const PORT = 4321;

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
  const res = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tickers }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!res.ok) throw new Error(`scan HTTP ${res.status}`);
  return res.json();
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
      execSync('npx next build', { cwd: ROOT, stdio: 'inherit' });
    }
    console.log(`[daily-snapshot] starting next start on :${PORT}…`);
    child = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
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
let failedChunks = 0;

try {
  for (let i = 0; i < universe.length; i += CHUNK) {
    const chunk = universe.slice(i, i + CHUNK);
    try {
      const out = await scanChunk(base, chunk);
      rows += out.rows?.length ?? 0;
      errors += out.errors?.length ?? 0;
      providerCalls += out.telemetry?.providerCalls ?? 0;
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
  `[daily-snapshot] done: ${rows} rows, ${errors} ticker errors, ${failedChunks} failed chunks, ${providerCalls} provider calls`
);
process.exit(rows > 0 ? 0 : 1);
