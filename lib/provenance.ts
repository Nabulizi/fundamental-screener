import { fcfBaseOptions, type ValuationProfile } from './valuation';

// Row-level provenance for the bottom "Data & sources" panel (static — the live
// "FCF base in use" lives with the valuation UI, not here). No quality score, no
// per-metric provenance, no verdict — just where the data came from and how
// complete it is.

export interface DataProvenance {
  source: 'finnhub' | 'alphavantage' | null;
  cached: boolean;
  retrievedAt: string;
  /** Annual years of reported history available (0 = none). */
  historyYears: number;
  historySource: 'finnhub-reported' | null;
  /** Labels of the FCF bases AVAILABLE (not the one in use). */
  availableBaseLabels: string[];
  /** True for a balance-sheet financial — FCF-derived valuation is gated. */
  fcfGated: boolean;
  /** True when the scorecard was floored for insufficient data. */
  insufficientData: boolean;
}

export function buildDataProvenance(args: {
  source?: 'finnhub' | 'alphavantage' | null; // undefined on pre-field snapshots → null
  cached?: boolean;
  retrievedAt: string;
  profile: ValuationProfile | null;
  fcf0: number | null;
  isFinancial: boolean;
  insufficientData: boolean;
}): DataProvenance {
  return {
    source: args.source ?? null,
    cached: args.cached ?? false,
    retrievedAt: args.retrievedAt,
    historyYears: args.profile?.history.length ?? 0,
    historySource: args.profile?.source ?? null,
    // Available bases: for a financial the DCF is gated, so none are offered.
    availableBaseLabels: args.isFinancial ? [] : fcfBaseOptions(args.profile, args.fcf0).map((b) => b.label),
    fcfGated: args.isFinancial,
    insufficientData: args.insufficientData,
  };
}
