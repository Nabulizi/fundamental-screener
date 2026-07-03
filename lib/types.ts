// Normalized, provider-agnostic shape. Every financial field is always present;
// `null` means "the provider did not supply a usable value" and is rendered as
// "N/A" in the UI. A real numeric 0 (e.g. a company that genuinely pays no
// dividend) is preserved as 0 and rendered honestly (e.g. "0.00%").
export interface ScanRow {
  ticker: string;
  companyName: string | null;
  industry: string | null;
  /** Market capitalization in raw units of `currency` (not millions). */
  marketCap: number | null;
  currency: string | null;
  week52Low: number | null;
  week52High: number | null;
  /** Trailing P/E. Non-positive / unavailable is normalized to null. */
  trailingPE: number | null;
  /** Forward P/E based on consensus earnings estimates. Non-positive / unavailable is null. */
  forwardPE: number | null;
  /** Dividend yield expressed as a percentage value (e.g. 3.05 means 3.05%). */
  dividendYieldPercent: number | null;
  /** Year-to-date price return as a percentage (e.g. 9.25 means +9.25%). */
  ytdReturn: number | null;
  /** Free cash flow yield as a percentage (derived from Price/FCF). Null if unavailable. */
  fcfYieldPercent: number | null;
  /** Revenue growth TTM year-over-year as a percentage (e.g. 12.76 means 12.76%). */
  revenueGrowthTTM: number | null;
  /** Total debt / total equity (quarterly). Null if unavailable. */
  debtToEquity: number | null;
  /** Enterprise value / EBITDA (TTM). Non-positive / unavailable is null. */
  evToEbitda: number | null;
  /**
   * Net interest coverage (TTM). Not displayed as a column; used by scoring to
   * arbitrate distorted D/E ratios (negative or extreme book equity). Optional —
   * null/absent means the provider did not supply it.
   */
  interestCoverage?: number | null;
  /** Current price in `currency`. Optional — populated only when the provider quote is available. */
  currentPrice?: number | null;
  /** Position within the 52-week range, 0..1 (low..high). Null when inputs are missing/invalid. */
  rangePosition?: number | null;
  /** True when this row was served from the server cache rather than freshly fetched. */
  cached?: boolean;
  /** ISO timestamp of when this row's data was actually retrieved from the provider. */
  retrievedAt: string;
}

export type ScanErrorCode =
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'INVALID_TICKER';

export interface ScanError {
  ticker: string;
  code: ScanErrorCode;
  message: string;
}

export interface ScanMeta {
  duplicatesRemoved: number;
  limited: boolean;
  maxTickers: number;
}

export interface ScanResponse {
  rows: ScanRow[];
  errors: ScanError[];
  /** Newest `retrievedAt` among rows, or null when there are no rows. */
  lastUpdatedAt: string | null;
  meta?: ScanMeta;
}
