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
  /**
   * Most-recent-quarter revenue growth YoY as a percentage. Compared against
   * `revenueGrowthTTM` by the revenue-acceleration criterion. Optional.
   */
  revenueGrowthQuarterly?: number | null;
  /** Operating margin TTM as a percentage. Used by the margin-inflection criterion. Optional. */
  operatingMarginTTM?: number | null;
  /** Operating margin 5-year average as a percentage. Baseline for margin inflection. Optional. */
  operatingMargin5Y?: number | null;
  /** Current price in `currency`. Optional — populated only when the provider quote is available. */
  currentPrice?: number | null;
  /** Position within the 52-week range, 0..1 (low..high). Null when inputs are missing/invalid. */
  rangePosition?: number | null;
  /** True when this row was served from the server cache rather than freshly fetched. */
  cached?: boolean;
  /**
   * Provider that produced this row (row-level provenance, not per-metric).
   * Optional for back-compat: snapshots written before this field lack it and
   * read back as undefined. `alphavantage` rows carry thinner data (FCF N/A).
   */
  source?: 'finnhub' | 'alphavantage' | null;
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
  /** Provider-economics counters for this scan (see lib/scan.ts ScanTelemetry). */
  telemetry?: {
    providerCalls: number;
    cacheHits: number;
    coalescedJoins: number;
    failures: number;
    /** Fresh daily snapshots successfully appended by this request. */
    snapshotsRecorded?: number;
  };
}
