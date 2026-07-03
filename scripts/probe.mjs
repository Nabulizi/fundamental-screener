#!/usr/bin/env node
// Phase 0 live provider probe. Confirms the Finnhub field map, units, and
// semantics against real data. Run AFTER setting FINNHUB_API_KEY in .env.local:
//
//   npm run probe
//
// It NEVER prints the API key. It probes:
//   AAPL  - ordinary dividend payer
//   KO    - high dividend payer (verifies yield is a percentage, ~3, not ~0.03)
//   AMZN  - non-dividend payer (distinguishes real 0% from missing)
//
// Negative / unavailable P/E is covered by unit-test fixtures, not live data,
// because live fundamentals change over time.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function loadEnvLocal() {
  try {
    const raw = await readFile(path.join(ROOT, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // no .env.local — rely on process env
  }
}

const BASE = 'https://finnhub.io/api/v1';

async function getJson(pathname, key) {
  const sep = pathname.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}${pathname}${sep}token=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${pathname.replace(/token=[^&]+/, 'token=***')}`);
  return res.json();
}

function show(label, value) {
  console.log(`    ${label.padEnd(26)} ${value}`);
}

async function probe(ticker, key) {
  console.log(`\n=== ${ticker} ===`);
  const [profile, metricResp, quote] = await Promise.all([
    getJson(`/stock/profile2?symbol=${ticker}`, key),
    getJson(`/stock/metric?symbol=${ticker}&metric=all`, key),
    getJson(`/quote?symbol=${ticker}`, key)
  ]);
  const metric = metricResp.metric ?? {};
  const cap = profile.marketCapitalization;
  show('name', profile.name);
  show('finnhubIndustry', profile.finnhubIndustry);
  show('currency', profile.currency);
  show('marketCapitalization', `${cap}  -> x1e6 = ${cap != null ? cap * 1e6 : 'n/a'} (expect ~1e12 for mega-cap => unit is millions)`);
  show('52WeekHigh', metric['52WeekHigh']);
  show('52WeekLow', metric['52WeekLow']);
  show('peTTM', metric['peTTM']);
  show('forwardPE', metric['forwardPE']);
  show('dividendYieldIndicatedAnnual', `${metric['dividendYieldIndicatedAnnual']}  (KO ~3 => percent; ~0.03 => decimal)`);
  show('pfcfShareTTM', `${metric['pfcfShareTTM']}  (Price/FCF ratio; app derives FCF yield = 100/this)`);
  show('revenueGrowthTTMYoy', `${metric['revenueGrowthTTMYoy']}  (percent, e.g. 12.76 = +12.76%; financials can be artifacts)`);
  show('revenueGrowthQuarterlyYoy', `${metric['revenueGrowthQuarterlyYoy']}  (percent; compared vs TTM by the acceleration criterion)`);
  show('totalDebt/totalEquityQuarterly', `${metric['totalDebt/totalEquityQuarterly']}  (RATIO, e.g. AAPL <2; negative = negative book equity)`);
  show('netInterestCoverageTTM', `${metric['netInterestCoverageTTM']}  (ratio; arbitrates distorted D/E — <2 is fatal)`);
  show('evEbitdaTTM', metric['evEbitdaTTM']);
  show('operatingMarginTTM', `${metric['operatingMarginTTM']}  (percent, e.g. AAPL ~30)`);
  show('operatingMargin5Y', `${metric['operatingMargin5Y']}  (percent; margin-inflection baseline)`);
  show('yearToDatePriceReturnDaily', `${metric['yearToDatePriceReturnDaily']}  (percent)`);
  show('quote.c (current price)', `${quote.c}  (expect a positive number between 52WeekLow and 52WeekHigh, in trading currency)`);
}

async function probeAlphaVantage(ticker, key) {
  console.log(`\n=== [Alpha Vantage] ${ticker} ===`);
  const base = 'https://www.alphavantage.co/query';
  const get = async (fn) => {
    const r = await fetch(`${base}?function=${fn}&symbol=${ticker}&apikey=${encodeURIComponent(key)}`);
    return r.json();
  };
  const [overview, quote] = await Promise.all([get('OVERVIEW'), get('GLOBAL_QUOTE')]);
  if (overview.Note || overview.Information) {
    console.log(`    RATE-LIMITED: ${overview.Note ?? overview.Information}`);
    return;
  }
  show('Name', overview.Name);
  show('Industry / Sector', `${overview.Industry} / ${overview.Sector}`);
  show('Currency', overview.Currency);
  show('MarketCapitalization', `${overview.MarketCapitalization}  (expect ~1e12 RAW for mega-cap; NOT millions)`);
  show('TrailingPE / PERatio', `${overview.TrailingPE} / ${overview.PERatio}`);
  show('DividendYield', `${overview.DividendYield}  (KO ~0.03 => decimal => x100 = percent)`);
  show('52WeekHigh / 52WeekLow', `${overview['52WeekHigh']} / ${overview['52WeekLow']}`);
  show('GLOBAL_QUOTE 05. price', quote['Global Quote'] ? quote['Global Quote']['05. price'] : JSON.stringify(quote));
}

async function main() {
  await loadEnvLocal();
  // FINNHUB_API_KEY supports comma-separated multiple keys (round-robin in the
  // app); the probe just needs one valid key.
  const key = (process.env.FINNHUB_API_KEY ?? '').split(',')[0].trim();
  if (!key) {
    console.error('FINNHUB_API_KEY is not set. Add it to .env.local (see .env.example) and retry.');
    process.exit(1);
  }
  console.log('FINNHUB_API_KEY detected (value hidden). Probing Finnhub…');
  for (const t of ['AAPL', 'KO', 'AMZN']) {
    try {
      await probe(t, key);
    } catch (err) {
      console.error(`  ${t}: ${err.message}`);
    }
  }
  console.log('\nConfirm above: Finnhub market cap unit = millions, dividend yield = percentage.');

  const avKey = process.env.ALPHAVANTAGE_API_KEY;
  if (avKey) {
    console.log('\nALPHAVANTAGE_API_KEY detected (value hidden). Probing Alpha Vantage failover…');
    // Alpha Vantage free tier is ~25 req/day; probe a couple of tickers only.
    for (const t of ['KO', 'AMZN']) {
      try {
        await probeAlphaVantage(t, avKey);
      } catch (err) {
        console.error(`  ${t}: ${err.message}`);
      }
    }
    console.log('\nConfirm above: Alpha Vantage market cap = RAW units, dividend yield = decimal (x100 for percent).');
  } else {
    console.log('\n(ALPHAVANTAGE_API_KEY not set — skipping failover probe. Set it in .env.local to verify the backup.)');
  }
}

main();
