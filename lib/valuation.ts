// Valuation-only, provider-agnostic historical fundamentals. Kept entirely
// separate from ScanRow (the bulk screener row) so the screener is never slowed
// or bloated by per-company history. Populated only on the detail page.
//
// Every numeric field follows the repo's missing≠zero rule: `null` means the
// provider didn't supply a usable value; a real 0 is preserved.

export interface ValuationYear {
  fiscalYear: number;
  fiscalPeriodEnd: string | null;
  revenue: number | null;
  operatingIncome: number | null;
  operatingCashFlow: number | null;
  /** Capex normalized as a POSITIVE outflow (Finnhub reports it positive). */
  capex: number | null;
  /** operatingCashFlow − capex; null if either input is missing. */
  freeCashFlow: number | null;
  stockBasedCompensation: number | null;
  sharesDiluted: number | null;
}

export interface ValuationProfile {
  ticker: string;
  /**
   * TTM free cash flow for base-year continuity. Sourced from the existing
   * ScanRow path (marketCap × fcfYield), NOT from history — set by the caller.
   * The provider leaves this null.
   */
  fcfTtm: number | null;
  /** Annual history, oldest → newest. May be empty (no source) or partial. */
  history: ValuationYear[];
  /** Latest diluted share count, for future per-share output (Phase 4). */
  sharesOutstanding: number | null;
  /**
   * Latest cash − total debt. Often null: reported debt coverage is partial, so
   * treat this as incomplete/future-only. Do NOT wire into the equity-FCF DCF
   * (that model keeps netCash = 0 — see lib/dcf.ts).
   */
  netCash: number | null;
  source: 'finnhub-reported' | null;
  retrievedAt: string;
}

export interface ValuationProvider {
  readonly name: string;
  fetchValuationProfile(ticker: string, signal?: AbortSignal): Promise<ValuationProfile>;
}

/**
 * Free cash flow = operating cash flow − capex, with capex normalized as a
 * positive outflow. Returns null if either input is missing — never coerces to
 * 0 (a missing capex line, e.g. a broker or REIT, must not read as "FCF = OCF").
 */
export function deriveFreeCashFlow(ocf: number | null, capex: number | null): number | null {
  if (ocf == null || capex == null) return null;
  return ocf - Math.abs(capex);
}

// --- Normalized FCF base (Phase 2) ------------------------------------------

export type FcfBaseKey = 'ttm' | 'avg3' | 'avg5';

export interface FcfBaseOption {
  key: FcfBaseKey;
  label: string;
  value: number;
  /** Number of annual years actually averaged (1 for TTM). */
  yearsUsed: number;
}

/** Usable (non-null) annual FCF values, most-recent first. */
export function usableFcfValues(profile: ValuationProfile | null): number[] {
  if (!profile) return [];
  return profile.history
    .slice()
    .reverse()
    .map((y) => y.freeCashFlow)
    .filter((v): v is number => v != null);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * FCF-base options honoring the roadmap availability rules:
 *   - TTM  : available iff a current TTM FCF exists.
 *   - 3Y avg: needs ≥2 usable annual years (averages up to 3), label the count.
 *   - 5Y avg: needs ≥3 usable annual years (averages up to 5), label the count.
 * Never coerces null→0; averages only usable years. Returns [] when nothing is
 * usable (caller then behaves like the TTM-only panel).
 */
export function fcfBaseOptions(profile: ValuationProfile | null, ttm: number | null): FcfBaseOption[] {
  const opts: FcfBaseOption[] = [];
  if (ttm != null) opts.push({ key: 'ttm', label: 'TTM', value: ttm, yearsUsed: 1 });

  const usable = usableFcfValues(profile);
  if (usable.length >= 2) {
    const n = Math.min(3, usable.length);
    opts.push({ key: 'avg3', label: `3Y avg (${n} yr)`, value: mean(usable.slice(0, n)), yearsUsed: n });
  }
  if (usable.length >= 3) {
    const n = Math.min(5, usable.length);
    opts.push({ key: 'avg5', label: `5Y avg (${n} yr)`, value: mean(usable.slice(0, n)), yearsUsed: n });
  }
  return opts;
}

/** Default base: TTM until ≥3 usable annual years exist, then the 3Y average. */
export function defaultFcfBaseKey(profile: ValuationProfile | null): FcfBaseKey {
  return usableFcfValues(profile).length >= 3 ? 'avg3' : 'ttm';
}
