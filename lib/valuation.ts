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
