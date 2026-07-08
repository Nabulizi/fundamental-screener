import { fetchWithRateLimitRetry, type RetryOptions } from './retry';
import { ProviderError } from './provider';
import { deriveFreeCashFlow, type ValuationProfile, type ValuationProvider, type ValuationYear } from './valuation';

const BASE_URL = 'https://finnhub.io/api/v1';

// Phase 0 verdict: standardized /stock/financials is 403 (premium) on the app's
// plan; /stock/financials-reported is available and free. We derive annual FCF
// as operatingCashFlow − capex from as-reported us-gaap concepts (matched on the
// stable `concept` name, not the human label).
const OCF = /NetCashProvidedByUsedInOperatingActivities/i;
// Genuine PP&E maintenance capex only. REIT real-estate ACQUISITION
// (PaymentsToAcquireRealEstate) is growth capex, deliberately excluded so a
// REIT's FCF stays null (a sector caveat) rather than a misleading figure.
const CAPEX = [
  /PaymentsToAcquirePropertyPlantAndEquipment/i,
  /PaymentsToAcquireProductiveAssets/i,
  /PaymentsForCapitalImprovements/i,
];
const SBC = /_ShareBasedCompensation$/i; // excludes ...ForShareBasedCompensation (tax withholding)
const REVENUE = [/RevenueFromContractWithCustomer/i, /_Revenues$/i, /SalesRevenueNet/i];
const OP_INCOME = /OperatingIncomeLoss/i;
const DILUTED = /WeightedAverageNumberOfDilutedSharesOutstanding/i;
const CASH = /CashAndCashEquivalentsAtCarryingValue/i;
const DEBT = [/LongTermDebtCurrent/i, /LongTermDebtNoncurrent/i, /_LongTermDebt$/i, /ShortTermBorrowings/i, /CommercialPaper/i];

interface ReportRow { concept?: string; value?: unknown }
interface ReportedEntry {
  year?: number;
  quarter?: number;
  endDate?: string;
  filedDate?: string;
  report?: { cf?: ReportRow[]; ic?: ReportRow[]; bs?: ReportRow[] };
}
interface ReportedRaw { data?: ReportedEntry[] }

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function pick(rows: ReportRow[], pats: RegExp | RegExp[]): number | null {
  const arr = Array.isArray(pats) ? pats : [pats];
  for (const r of rows) {
    if (arr.some((re) => re.test(r.concept ?? ''))) {
      const n = num(r.value);
      if (n != null) return n;
    }
  }
  return null;
}
function sum(rows: ReportRow[], pats: RegExp[]): number | null {
  let total: number | null = null;
  for (const r of rows) {
    if (pats.some((re) => re.test(r.concept ?? ''))) {
      const n = num(r.value);
      if (n != null) total = (total ?? 0) + n;
    }
  }
  return total;
}

/**
 * Parse a Finnhub /stock/financials-reported payload into a ValuationProfile.
 * Exported and pure so it can be unit-tested against captured fixtures without
 * a network call. Keeps the most-recently-filed view of each fiscal year.
 */
export function parseFinancialsReported(raw: unknown, ticker: string, retrievedAt: string): ValuationProfile {
  const data = (raw as ReportedRaw)?.data;
  const byYear = new Map<number, ReportedEntry>();
  if (Array.isArray(data)) {
    for (const e of data) {
      if (e?.quarter !== 0 || typeof e?.year !== 'number') continue; // quarter 0 = annual
      const prev = byYear.get(e.year);
      if (!prev || String(e.filedDate ?? '') > String(prev.filedDate ?? '')) byYear.set(e.year, e);
    }
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const history: ValuationYear[] = years.map((y) => {
    const e = byYear.get(y)!;
    const cf = e.report?.cf ?? [];
    const ic = e.report?.ic ?? [];
    const ocf = pick(cf, OCF);
    const capexRaw = pick(cf, CAPEX);
    const capex = capexRaw == null ? null : Math.abs(capexRaw);
    return {
      fiscalYear: y,
      fiscalPeriodEnd: e.endDate ?? null,
      revenue: pick(ic, REVENUE),
      operatingIncome: pick(ic, OP_INCOME),
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: deriveFreeCashFlow(ocf, capex),
      stockBasedCompensation: pick(cf, SBC),
      sharesDiluted: pick(ic, DILUTED),
    };
  });

  const latest = years.length ? byYear.get(years[years.length - 1])! : null;
  const latestBs = latest?.report?.bs ?? [];
  const cash = pick(latestBs, CASH);
  const debt = sum(latestBs, DEBT);
  return {
    ticker,
    fcfTtm: null, // set by the caller from the ScanRow path
    history,
    sharesOutstanding: history.length ? history[history.length - 1].sharesDiluted : null,
    netCash: cash != null && debt != null ? cash - debt : null,
    source: history.length ? 'finnhub-reported' : null,
    retrievedAt,
  };
}

/** Finnhub-backed valuation provider. Server-only path (reads no key of its own
 *  beyond the one passed by buildValuationProvider). */
export function createFinnhubValuationProvider(apiKey: string, retryOpts?: RetryOptions): ValuationProvider {
  return {
    name: 'finnhub-valuation',
    async fetchValuationProfile(ticker: string, signal?: AbortSignal): Promise<ValuationProfile> {
      const url = `${BASE_URL}/stock/financials-reported?symbol=${encodeURIComponent(ticker)}&freq=annual&token=${apiKey}`;
      let res: Response;
      try {
        res = await fetchWithRateLimitRetry(url, { signal }, retryOpts);
      } catch {
        throw new ProviderError('PROVIDER_ERROR', `Network error fetching valuation history for "${ticker}".`);
      }
      if (res.status === 429) throw new ProviderError('RATE_LIMITED', `Rate limited on valuation history for "${ticker}".`);
      if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `HTTP ${res.status} fetching valuation history for "${ticker}".`);
      const raw = await res.json();
      return parseFinancialsReported(raw, ticker, new Date().toISOString());
    },
  };
}
