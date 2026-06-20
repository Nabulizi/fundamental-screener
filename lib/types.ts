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
  /** Dividend yield expressed as a percentage value (e.g. 3.05 means 3.05%). */
  dividendYieldPercent: number | null;
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
