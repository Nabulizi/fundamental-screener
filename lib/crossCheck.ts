import type { ScanRow } from './types';

// SHALLOW cross-check: compare the primary provider (Finnhub) against an
// independent secondary (Alpha Vantage) on the only fields both supply —
// market cap, price, P/E, dividend yield. It does NOT validate FCF, revenue
// growth, margins, capex, or history. Neutral: "agrees" / "differs", never
// "wrong". Detail-page only. Suppressed when there's no independent second
// source (no AV key, or the primary IS the AV failover).

export interface CrossCheckField {
  key: 'marketCap' | 'currentPrice' | 'trailingPE' | 'dividendYieldPercent';
  label: string;
  primary: number | null;
  secondary: number | null;
  status: 'agree' | 'differ' | 'unavailable';
  /** Relative difference |a−b|/|a|, or null when not comparable. */
  pctDiff: number | null;
}

export interface CrossCheck {
  available: boolean;
  reason?: string;
  fields: CrossCheckField[];
}

// Generous relative tolerances — AV updates less often, so small gaps are noise;
// only a material divergence is worth surfacing.
const TOLERANCE: Record<CrossCheckField['key'], number> = {
  marketCap: 0.03,
  currentPrice: 0.03,
  trailingPE: 0.05,
  dividendYieldPercent: 0.10,
};

const FIELDS: { key: CrossCheckField['key']; label: string }[] = [
  { key: 'marketCap', label: 'Market cap' },
  { key: 'currentPrice', label: 'Price' },
  { key: 'trailingPE', label: 'P/E (TTM)' },
  { key: 'dividendYieldPercent', label: 'Dividend yield' },
];

function compare(primary: number | null, secondary: number | null, tol: number): { status: CrossCheckField['status']; pctDiff: number | null } {
  if (primary == null || secondary == null) return { status: 'unavailable', pctDiff: null };
  if (primary === 0) return { status: primary === secondary ? 'agree' : 'differ', pctDiff: null };
  const pctDiff = Math.abs(primary - secondary) / Math.abs(primary);
  return { status: pctDiff <= tol ? 'agree' : 'differ', pctDiff };
}

/**
 * Build the cross-check model. `available` is false (with a reason) when there is
 * no independent second source: AV not configured, the primary row is itself
 * from AV (failover), or the AV fetch failed.
 */
export function buildCrossCheck(args: {
  primary: ScanRow;
  secondary: ScanRow | null;
  hasSecondaryProvider: boolean;
}): CrossCheck {
  if (!args.hasSecondaryProvider) return { available: false, reason: 'Alpha Vantage not configured — no independent second source.', fields: [] };
  if (args.primary.source === 'alphavantage') return { available: false, reason: 'Primary source is already Alpha Vantage — no independent second source.', fields: [] };
  if (!args.secondary) return { available: false, reason: 'Second source (Alpha Vantage) unavailable.', fields: [] };

  const get = (r: ScanRow, k: CrossCheckField['key']): number | null =>
    k === 'currentPrice' ? r.currentPrice ?? null : (r[k] as number | null);

  const fields: CrossCheckField[] = FIELDS.map(({ key, label }) => {
    const primary = get(args.primary, key);
    const secondary = get(args.secondary!, key);
    const { status, pctDiff } = compare(primary, secondary, TOLERANCE[key]);
    return { key, label, primary, secondary, status, pctDiff };
  });

  return { available: true, fields };
}
