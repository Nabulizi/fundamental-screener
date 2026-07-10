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

// ---------------------------------------------------------------------------
// Phase 0 valuation-history probe (roadmap issues #9/#10). Answers ONE question
// with evidence: can Finnhub supply enough ANNUAL history for a normalized FCF
// base + drivers on the current plan? No provider code is written here.
//
//   npm run probe -- --valuation                 (prints the evidence tables)
//   npm run probe -- --valuation --write-fixtures (also saves sanitized bodies)
//
// Never prints or saves the API key; fixtures store response BODIES only.
// ---------------------------------------------------------------------------

const VAL_TICKERS = ['AAPL', 'MU', 'XOM', 'HOOD', 'PLD']; // tech, semi/cyclical, energy, broker-edge, REIT

// A non-throwing fetch: one failing endpoint must not abort the others.
async function getJsonSafe(pathname, key) {
  const sep = pathname.includes('?') ? '&' : '?';
  const safe = `${pathname}${sep}token=***`;
  try {
    const res = await fetch(`${BASE}${pathname}${sep}token=${encodeURIComponent(key)}`);
    let body = null;
    let malformed = false;
    try { body = await res.json(); } catch { malformed = true; }
    return { status: res.status, ok: res.ok, malformed, body, safe };
  } catch (err) {
    return { status: null, ok: false, malformed: false, body: null, safe, error: err.message };
  }
}

function statusLabel(r) {
  if (r.status === null) return `error (${r.error})`;
  if (r.status === 403) return '403 (premium / forbidden on this plan)';
  if (r.status === 429) return '429 (rate-limited)';
  if (!r.ok) return `HTTP ${r.status}`;
  if (r.malformed || r.body == null) return 'malformed (non-JSON)';
  return 'ok';
}

const yn = (v) => (v ? 'yes' : 'no');

// metric=all → series.annual is a map of { metricName: [{period, v}, ...] }.
function analyzeSeries(body) {
  const annual = body?.series?.annual;
  if (!annual || typeof annual !== 'object') return { rows: 0, keys: [] };
  const keys = Object.keys(annual);
  let rows = 0;
  for (const k of keys) if (Array.isArray(annual[k])) rows = Math.max(rows, annual[k].length);
  const has = (re) => keys.some((k) => re.test(k));
  return {
    rows, keys,
    fcf: has(/fcf|freecash/i),        // typically fcfMargin / fcfPerShare (derived, not raw $)
    capex: has(/capex|capital/i),
    sbc: has(/sbc|stockbased|sharebased/i),
    shares: has(/share/i),
    margin: has(/margin/i),
    revenuePerShare: has(/s(ales|revenue)pershare/i),
  };
}

// Standardized /stock/financials?statement=... → { financials: [ {period, ...lineItems} ] }.
function analyzeStandardized(body) {
  const arr = body?.financials;
  if (!Array.isArray(arr) || arr.length === 0) return { rows: 0, keys: [] };
  return { rows: arr.length, keys: Object.keys(arr[0]) };
}
// Union of line-item keys across all standardized rows (the first row can be sparse).
function stdKeys(body) {
  const arr = body?.financials;
  if (!Array.isArray(arr)) return [];
  const s = new Set();
  for (const row of arr) for (const k of Object.keys(row)) s.add(k);
  return [...s];
}
// First finite numeric value whose key matches `re`, across standardized rows (for capex sign).
function stdValue(body, re) {
  const arr = body?.financials;
  if (!Array.isArray(arr)) return null;
  for (const row of arr) for (const [k, v] of Object.entries(row)) {
    if (re.test(k) && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

// financials-reported → { data: [ { year, report: { bs:[], ic:[], cf:[] } } ] }.
// Each report section is [{concept, label, unit, value}]. Keyword-match presence + capex sign.
function rows(section) { return Array.isArray(section) ? section : []; }
function findRow(section, re) {
  return rows(section).find((x) => re.test(`${x.concept ?? ''} ${x.label ?? ''}`.toLowerCase()));
}
function analyzeReported(body) {
  const data = body?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const rep = data[0]?.report ?? {};
  const cf = rep.cf, ic = rep.ic, bs = rep.bs;
  const capexRow = findRow(cf, /capital expenditure|paymentstoacquireproperty|purchase.*propert.*equipment/i);
  const capexVal = capexRow && Number.isFinite(Number(capexRow.value)) ? Number(capexRow.value) : null;
  return {
    rows: data.length,
    ocf: !!findRow(cf, /netcashprovided.*operating|cash.*from.*operating|operating activities/i),
    capex: !!capexRow,
    capexSign: capexVal == null ? 'unknown' : capexVal < 0 ? 'negative (outflow)' : 'positive',
    revenue: !!findRow(ic, /revenue|net sales/i),
    operatingIncome: !!findRow(ic, /operating income/i),
    sbc: !!(findRow(cf, /share-?based|stock-?based compensation/i) || findRow(ic, /share-?based|stock-?based compensation/i)),
    dilutedShares: !!findRow(ic, /diluted|weightedaverage.*dilut/i),
    cash: !!findRow(bs, /cash and cash equivalents/i),
    longTermDebt: !!findRow(bs, /long-?term debt/i),
  };
}

function annualReportedEntries(body) {
  const data = body?.data;
  return Array.isArray(data)
    ? data.filter((e) => e?.quarter === 0 && typeof e?.year === 'number')
    : [];
}

function shortDate(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 10) : 'missing';
}

function analyzeReportedPit(body) {
  const entries = annualReportedEntries(body);
  if (entries.length === 0) return null;

  const byYear = new Map();
  const filedDates = [];
  for (const e of entries) {
    const year = e.year;
    const filed = shortDate(e.filedDate);
    const ended = shortDate(e.endDate);
    if (filed !== 'missing') filedDates.push(filed);
    if (!byYear.has(year)) {
      byYear.set(year, { rows: 0, filedDates: new Set(), endDates: new Set(), filingKeys: new Set() });
    }
    const rec = byYear.get(year);
    rec.rows += 1;
    rec.filedDates.add(filed);
    rec.endDates.add(ended);
    rec.filingKeys.add(`${filed}|${ended}`);
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  filedDates.sort();
  const perYear = years.map((year) => ({ year, ...byYear.get(year) }));
  const multiFiledYears = perYear.filter((r) => r.filedDates.size > 1);
  const duplicateSameFilingYears = perYear.filter((r) => r.rows > r.filingKeys.size);

  return {
    annualRows: entries.length,
    years,
    fiscalSpan: `${years[0]}-${years[years.length - 1]}`,
    filedSpan: filedDates.length ? `${filedDates[0]} -> ${filedDates[filedDates.length - 1]}` : 'missing',
    perYear,
    multiFiledYears,
    duplicateSameFilingYears,
    maxFiledVersions: Math.max(...perYear.map((r) => r.filedDates.size)),
    maxRowsPerYear: Math.max(...perYear.map((r) => r.rows)),
  };
}

function yearList(rows, limit = 8) {
  const labels = rows
    .slice()
    .sort((a, b) => b.year - a.year)
    .slice(0, limit)
    .map((r) => `FY${r.year}`);
  return labels.join(', ') + (rows.length > limit ? ` +${rows.length - limit} more` : '');
}

function showPitSummary(body) {
  const pit = analyzeReportedPit(body);
  if (!pit) {
    show('reported PIT span', 'no annual rows');
    return null;
  }

  show('reported PIT span', `${pit.annualRows} annual rows, FY ${pit.fiscalSpan}, filed ${pit.filedSpan}`);
  show('filed versions/FY', pit.multiFiledYears.length
    ? `yes (${yearList(pit.multiFiledYears)} have >1 filedDate)`
    : 'no evidence (one filedDate per fiscal year in this response)');
  show('duplicate same-filing rows', pit.duplicateSameFilingYears.length
    ? `yes (${yearList(pit.duplicateSameFilingYears)} repeat same filedDate/endDate; not restatement versions)`
    : 'no');
  show('PIT interpretation', pit.multiFiledYears.length
    ? 'versioned filings observed; select latest filedDate <= as-of date'
    : 'dated history only; can gate by filedDate, but restatement-safety is unproven');
  return pit;
}

// All concept+label strings across a financials-reported entry's cf/ic/bs (for keyword evidence).
function reportedConcepts(body) {
  const data = body?.data;
  if (!Array.isArray(data) || data.length === 0) return [];
  const rep = data[0]?.report ?? {};
  return [...rows(rep.cf), ...rows(rep.ic), ...rows(rep.bs)]
    .map((x) => `${x.concept ?? ''} ${x.label ?? ''}`.toLowerCase());
}

async function saveFixture(ticker, tag, body) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = path.join(ROOT, 'test', 'fixtures', 'valuation');
  await mkdir(dir, { recursive: true });
  // Bodies are provider response payloads — they contain no key. Save as-is.
  await writeFile(path.join(dir, `${ticker}.${tag}.json`), JSON.stringify(body ?? null, null, 2));
}

async function probeValuation(key, writeFixtures) {
  console.log('Phase 0 valuation-history probe — evidence only, no provider code.\n');
  const agg = { series: false, standardized: false, reported: false, capexSign: new Set() };

  for (const t of VAL_TICKERS) {
    console.log(`=== ${t} ===`);
    // Serial, low-concurrency: one endpoint at a time to respect rate limits.
    const endpoints = [
      ['metric=all series.annual', `/stock/metric?symbol=${t}&metric=all`, 'metric'],
      ['financials cf (annual)', `/stock/financials?symbol=${t}&statement=cf&freq=annual`, 'financials-cf'],
      ['financials ic (annual)', `/stock/financials?symbol=${t}&statement=ic&freq=annual`, 'financials-ic'],
      ['financials bs (annual)', `/stock/financials?symbol=${t}&statement=bs&freq=annual`, 'financials-bs'],
      ['financials-reported (annual)', `/stock/financials-reported?symbol=${t}&freq=annual`, 'financials-reported'],
    ];
    const got = {};
    for (const [label, pathname, tag] of endpoints) {
      const r = await getJsonSafe(pathname, key);
      got[tag] = r;
      let detail = '';
      if (r.ok && r.body) {
        if (tag === 'metric') { const a = analyzeSeries(r.body); detail = `, ${a.rows} annual rows`; }
        else if (tag === 'financials-reported') { const a = analyzeReported(r.body); detail = a ? `, ${a.rows} rows` : ', 0 rows'; }
        else { const a = analyzeStandardized(r.body); detail = `, ${a.rows} annual rows`; }
      }
      show(label, `${statusLabel(r)}${detail}`);
      if (writeFixtures && r.body) await saveFixture(t, tag, r.body);
    }

    // Field availability: prefer STANDARDIZED /stock/financials (cf/ic/bs), fall
    // back to financials-reported when standardized is unavailable or thin.
    const ser = got.metric?.ok ? analyzeSeries(got.metric.body) : null;
    const cfBody = got['financials-cf']?.ok ? got['financials-cf'].body : null;
    const icBody = got['financials-ic']?.ok ? got['financials-ic'].body : null;
    const bsBody = got['financials-bs']?.ok ? got['financials-bs'].body : null;
    const rep = got['financials-reported']?.ok ? analyzeReported(got['financials-reported'].body) : null;

    const stdAllKeys = [...stdKeys(cfBody), ...stdKeys(icBody), ...stdKeys(bsBody)];
    const stdRows = Math.max(
      analyzeStandardized(cfBody).rows, analyzeStandardized(icBody).rows, analyzeStandardized(bsBody).rows
    );

    let F = null;
    let fieldSource = 'none — no annual source answered';
    if (stdRows > 0) {
      const has = (re) => stdAllKeys.some((k) => re.test(k));
      const capexRe = /capitalexpenditure|capex|paymentstoacquire.*propert|purchase.*propert.*equip/i;
      const capexVal = stdValue(cfBody, capexRe);
      F = {
        ocf: has(/netcash.*operat|operatingcashflow|cashflowfromoperat|cashfromoperat/i),
        capex: has(capexRe),
        capexSign: capexVal == null ? 'unknown' : capexVal < 0 ? 'negative (outflow)' : 'positive',
        revenue: has(/revenue|totalrevenue|netsales|\bsales\b/i),
        operatingIncome: has(/operatingincome/i),
        sbc: has(/stockbasedcompensation|sharebasedcompensation/i),
        dilutedShares: has(/diluted.*shar|weightedaverage.*dilut|dilutedaverageshares/i),
        cash: has(/cashandcashequivalents|cashandshortterm/i),
        debt: has(/totaldebt/i) ? 'yes (total)' : has(/longtermdebt/i) ? 'partial (long-term line)' : 'no',
      };
      fieldSource = `standardized /stock/financials (${stdRows} annual rows)`;
    } else if (rep) {
      F = {
        ocf: rep.ocf, capex: rep.capex, capexSign: rep.capexSign, revenue: rep.revenue,
        operatingIncome: rep.operatingIncome, sbc: rep.sbc, dilutedShares: rep.dilutedShares,
        cash: rep.cash, debt: rep.longTermDebt ? 'partial (long-term line; short-term separate)' : 'no',
      };
      fieldSource = 'financials-reported (standardized unavailable/thin)';
    }

    // Evidence-based: is there a RAW free-cash-flow $ line among the returned keys
    // (not a margin/per-share ratio)? Check standardized keys, reported concepts, series.
    const repConcepts = got['financials-reported']?.ok ? reportedConcepts(got['financials-reported'].body) : [];
    const serKeys = ser?.keys ?? [];
    const rawFcfRe = /free ?cash ?flow/i;
    const ratioRe = /margin|per ?share|yield/i;
    const directFcf = [...stdAllKeys, ...repConcepts, ...serKeys].some((k) => rawFcfRe.test(k) && !ratioRe.test(k));
    const fcfRatioInSeries = serKeys.some((k) => /fcf|freecash/i.test(k));

    if (stdRows > 0) agg.standardized = true;
    if (ser?.rows) agg.series = true;
    if (rep?.rows) agg.reported = true;
    if (F?.capexSign && F.capexSign !== 'unknown') agg.capexSign.add(F.capexSign);

    console.log(`  --- annual field availability (source: ${fieldSource}) ---`);
    show('series.annual keys', ser ? `${ser.keys.slice(0, 16).join(', ')}${ser.keys.length > 16 ? ' …' : ''}` : 'n/a');
    show('direct FCF ($ line)', `${yn(directFcf)}  (evidence: raw FCF line among returned keys${fcfRatioInSeries ? '; series has an fcf ratio → derivable' : ''})`);
    show('FCF via OCF − capex', F ? yn(F.ocf && F.capex) : 'unknown');
    show('capex sign', F ? F.capexSign : 'unknown');
    show('revenue', F ? yn(F.revenue) : 'unknown');
    show('operating income', F ? yn(F.operatingIncome) : 'unknown');
    show('SBC', F ? yn(F.sbc) : 'unknown');
    show('diluted shares', F ? yn(F.dilutedShares) : 'unknown');
    show('cash', F ? yn(F.cash) : 'unknown');
    show('total debt', F ? F.debt : 'unknown');
    if (got['financials-reported']?.ok) {
      console.log('  --- financials-reported PIT/versioning ---');
      showPitSummary(got['financials-reported'].body);
    }
    console.log('');
  }

  // Evidence-based recommendation.
  console.log('=== RECOMMENDATION ===');
  if (agg.standardized) {
    console.log('  Dedicated financials path viable: /stock/financials (standardized) returned annual');
    console.log('  rows on this plan — cleanest structured source for FCF drivers.');
  } else if (agg.reported) {
    console.log('  Dedicated financials-reported path viable (free tier): OCF/capex/revenue/opinc/SBC/');
    console.log('  shares are present, so derive FCF = OCF − capex. Standardized /financials appears');
    console.log('  premium (403). Build the Phase-1 valuation provider on financials-reported.');
  } else if (agg.series) {
    console.log('  Only metric=all series.annual is available — good for margins/per-share ratios but');
    console.log('  NOT raw capex/SBC/share $ lines. Enough for a normalized FCF-margin base, thin for');
    console.log('  the full driver panel (#10). Treat #10 as partially blocked pending a better source.');
  } else {
    console.log('  INSUFFICIENT DATA: no annual-history source answered on this plan. Phase 1 blocked —');
    console.log('  revisit the provider/tier before building valuation plumbing.');
  }
  if (agg.capexSign.size) console.log(`  Capex sign convention observed: ${[...agg.capexSign].join(' / ')}.`);
  console.log('  (Confirm the field map above before writing lib/valuationProvider.ts — do not assume.)');
}

// ---------------------------------------------------------------------------
// Point-in-time fundamentals probe. This is the narrow backtest blocker:
// does /stock/financials-reported return dated annual history, and does it
// include multiple filed versions per fiscal year or only one current view?
//
//   npm run probe -- --pit
// ---------------------------------------------------------------------------

const PIT_TICKERS = ['AAPL', 'MSFT', 'AMZN', 'GOOG', 'META', 'NVDA', 'JPM', 'XOM', 'MCD', 'WMT', 'MU', 'AVGO', 'PLD', 'HOOD', 'RIVN'];

async function probePit(key) {
  console.log('Point-in-time fundamentals probe — financials-reported only.\n');
  const agg = {
    ok: 0,
    multiFiled: 0,
    duplicateSameFiling: 0,
    earliestFiled: null,
    latestFiled: null,
    maxRowsPerYear: 0,
  };

  for (const t of PIT_TICKERS) {
    console.log(`=== ${t} ===`);
    const r = await getJsonSafe(`/stock/financials-reported?symbol=${t}&freq=annual`, key);
    show('financials-reported', statusLabel(r));
    if (!r.ok || !r.body) {
      console.log('');
      continue;
    }

    const pit = showPitSummary(r.body);
    if (pit) {
      agg.ok += 1;
      if (pit.multiFiledYears.length) agg.multiFiled += 1;
      if (pit.duplicateSameFilingYears.length) agg.duplicateSameFiling += 1;
      agg.maxRowsPerYear = Math.max(agg.maxRowsPerYear, pit.maxRowsPerYear);
      const [earliest, latest] = pit.filedSpan.split(' -> ');
      if (earliest !== 'missing' && (!agg.earliestFiled || earliest < agg.earliestFiled)) agg.earliestFiled = earliest;
      if (latest !== 'missing' && (!agg.latestFiled || latest > agg.latestFiled)) agg.latestFiled = latest;
    }
    console.log('');
  }

  console.log('=== PIT VERDICT ===');
  console.log(`  financials-reported answered for ${agg.ok}/${PIT_TICKERS.length} tickers.`);
  if (agg.ok) {
    console.log(`  Filed-date span observed: ${agg.earliestFiled ?? 'missing'} -> ${agg.latestFiled ?? 'missing'}.`);
    console.log(`  Tickers with >1 filedDate for a fiscal year: ${agg.multiFiled}/${agg.ok}.`);
    console.log(`  Tickers with repeated same-filing annual rows: ${agg.duplicateSameFiling}/${agg.ok}.`);
  }
  if (agg.multiFiled > 0) {
    console.log('  True versioning appears present in at least one response. A backtest loader can store');
    console.log('  all annual rows and select the latest filedDate <= each rebalance date.');
  } else if (agg.ok > 0) {
    console.log('  Dated annual history is present, but this probe did NOT observe multiple filedDates');
    console.log('  for the same fiscal year. That is enough to prevent pre-filing lookahead, but not');
    console.log('  enough to prove restatement-safe point-in-time fundamentals.');
  } else {
    console.log('  No usable annual reported history observed. Fundamental backtest data remains blocked.');
  }
}

// ---------------------------------------------------------------------------
// Sector-native capability probe (roadmap #7). Evidence for docs/sector-coverage.md:
// are P/B, ROE, book value, and clean equity / net-income concepts actually
// available for real banks/insurers/REITs? Guards the known hazards — the
// StockholdersEquity vs LiabilitiesAndStockholdersEquity collision and the
// custom net-income namespace (e.g. amb_ for some REITs).
//
//   npm run probe -- --sector
// ---------------------------------------------------------------------------

const SECTOR_TICKERS = [['JPM', 'Banks'], ['BAC', 'Banks'], ['USB', 'Banks'], ['MET', 'Insurance'], ['O', 'REIT']];

function latestAnnual(reportedBody) {
  const data = reportedBody?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const annual = data.filter((e) => e?.quarter === 0).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return annual[0] ?? null;
}
function findReportRow(entry, sections, pred) {
  for (const sec of sections) {
    for (const r of entry?.report?.[sec] ?? []) {
      if (pred(r.concept ?? '')) return { concept: r.concept, value: r.value };
    }
  }
  return null;
}

async function probeSector(key) {
  console.log('Sector-native capability probe — evidence only, NO UI is built from this.\n');
  const agg = { pb: 0, roe: 0, cleanEquity: 0, netIncome: 0, total: SECTOR_TICKERS.length };

  for (const [t, sector] of SECTOR_TICKERS) {
    console.log(`=== ${t} (${sector}) ===`);
    const m = await getJsonSafe(`/stock/metric?symbol=${t}&metric=all`, key);
    const rep = await getJsonSafe(`/stock/financials-reported?symbol=${t}&freq=annual`, key);
    const metric = m.ok ? m.body?.metric ?? {} : {};

    show('metric=all status', statusLabel(m));
    show('  pbAnnual', metric['pbAnnual'] ?? '(missing)');
    show('  roeTTM', metric['roeTTM'] ?? '(missing)');
    show('  bookValuePerShareAnnual', metric['bookValuePerShareAnnual'] ?? '(missing)');
    if (metric['pbAnnual'] != null) agg.pb++;
    if (metric['roeTTM'] != null) agg.roe++;

    const entry = rep.ok ? latestAnnual(rep.body) : null;
    // Clean equity: exactly StockholdersEquity, NOT the total L+E, NOT the
    // "IncludingPortionAttributableToNoncontrollingInterest" variant.
    const eqClean = entry && findReportRow(entry, ['bs'],
      (c) => /(^|_)StockholdersEquity$/.test(c) && !/LiabilitiesAnd/.test(c) && !/IncludingPortion/i.test(c));
    const eqTotalOnly = entry && findReportRow(entry, ['bs'], (c) => /LiabilitiesAndStockholdersEquity$/.test(c));
    const ni = entry && findReportRow(entry, ['ic'], (c) => /NetIncomeLoss/i.test(c));

    show('financials-reported', statusLabel(rep) + (entry ? ` (FY ${entry.year})` : ''));
    show('  clean equity', eqClean ? `${eqClean.concept} = ${eqClean.value}`
      : eqTotalOnly ? `NONE — only total ${eqTotalOnly.concept} (COLLISION)` : 'NOT FOUND');
    show('  net income', ni ? `${ni.concept} = ${ni.value}${ni.concept.startsWith('us-gaap_') ? '' : '  (⚠ non-us-gaap namespace)'}` : 'NOT FOUND');
    if (eqClean) agg.cleanEquity++;
    if (ni && ni.concept.startsWith('us-gaap_')) agg.netIncome++;
    console.log('');
  }

  console.log('=== RECOMMENDATION ===');
  const clean = agg.pb === agg.total && agg.roe === agg.total && agg.cleanEquity === agg.total && agg.netIncome === agg.total;
  if (clean) {
    console.log('  P/B + ROE follow-up VIABLE — pb/roe present in metric=all AND clean equity + us-gaap');
    console.log('  net income resolvable for every probed financial. Revisit docs/sector-coverage.md.');
  } else {
    console.log(`  DO NOT BUILD sector UI — pb ${agg.pb}/${agg.total}, roe ${agg.roe}/${agg.total}, clean`);
    console.log(`  equity ${agg.cleanEquity}/${agg.total}, us-gaap net income ${agg.netIncome}/${agg.total}.`);
    console.log('  Missing/ambiguous fields make P/B or ROE unreliable. See docs/sector-coverage.md.');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const valuationMode = args.includes('--valuation');
  const sectorMode = args.includes('--sector');
  const pitMode = args.includes('--pit');
  const writeFixtures = args.includes('--write-fixtures');

  await loadEnvLocal();
  // FINNHUB_API_KEY supports comma-separated multiple keys (round-robin in the
  // app); the probe just needs one valid key.
  const key = (process.env.FINNHUB_API_KEY ?? '').split(',')[0].trim();
  if (!key) {
    console.error('FINNHUB_API_KEY is not set. Add it to .env.local (see .env.example) and retry.');
    process.exit(1);
  }

  if (valuationMode) {
    console.log('FINNHUB_API_KEY detected (value hidden).');
    await probeValuation(key, writeFixtures);
    return;
  }

  if (pitMode) {
    console.log('FINNHUB_API_KEY detected (value hidden).');
    await probePit(key);
    return;
  }

  if (sectorMode) {
    console.log('FINNHUB_API_KEY detected (value hidden).');
    await probeSector(key);
    return;
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
