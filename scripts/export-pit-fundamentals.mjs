#!/usr/bin/env node
// Export raw Finnhub /stock/financials-reported (annual) for a fixed universe,
// one file per ticker, for the should-i-trade PIT v0 backtester to consume.
//
//   npm run export:pit                 # writes data/pit/<TICKER>.json
//   node scripts/export-pit-fundamentals.mjs --out ../should-i-trade/.pit_data
//
// Dumb on purpose: NO extraction/scoring here. It dumps the raw provider body
// (which carries filedDate + endDate + us-gaap report rows); all signal logic
// lives in the Python backtester so there is one source of truth for the
// reduced historical score. Needs FINNHUB_API_KEY (.env.local). Never prints it.
//
// Universe: mature large caps vetted for CONTINUOUS Finnhub history — GOOGL (not
// GOOG, whose reported history is a 4-year stub), no post-2020 IPOs. This set is
// survivorship-biased by construction (see docs/quant-research-plan.md).

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = 'https://finnhub.io/api/v1';

// Keep in sync with UNIVERSE in should-i-trade/pit_backtest.py.
const UNIVERSE = [
  'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'AVGO', 'ORCL', 'CSCO', 'INTC',
  'JPM', 'BAC', 'V', 'MA', 'UNH', 'JNJ', 'PG', 'KO', 'PEP', 'HD',
  'MCD', 'WMT', 'XOM', 'CVX', 'DIS',
];

async function loadEnvLocal() {
  try {
    const raw = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* rely on process env */ }
}

async function getJson(pathname, key) {
  const sep = pathname.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${pathname}${sep}token=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${pathname.replace(/token=[^&]+/, 'token=***')}`);
  return res.json();
}

async function main() {
  await loadEnvLocal();
  const key = (process.env.FINNHUB_API_KEY ?? '').split(',')[0].trim();
  if (!key) { console.error('FINNHUB_API_KEY not set (.env.local).'); process.exit(1); }

  const outArg = process.argv.indexOf('--out');
  const outDir = outArg !== -1 ? path.resolve(process.argv[outArg + 1]) : path.join(ROOT, 'data', 'pit');
  await mkdir(outDir, { recursive: true });
  console.log(`Exporting ${UNIVERSE.length} tickers -> ${outDir}\n`);

  let ok = 0;
  for (const t of UNIVERSE) {
    try {
      const body = await getJson(`/stock/financials-reported?symbol=${t}&freq=annual`, key);
      const rows = Array.isArray(body?.data) ? body.data.filter((e) => e?.quarter === 0).length : 0;
      await writeFile(path.join(outDir, `${t}.json`), JSON.stringify(body ?? null));
      console.log(`  ${t.padEnd(6)} ${rows} annual rows`);
      ok += 1;
    } catch (e) {
      console.error(`  ${t.padEnd(6)} FAILED: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 300)); // be polite to Finnhub
  }
  console.log(`\nDone: ${ok}/${UNIVERSE.length} exported.`);
}

main();
