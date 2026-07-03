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
