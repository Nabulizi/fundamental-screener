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
  /**
   * Latest annual DILUTED WEIGHTED-AVERAGE share count from the provider — NOT a
   * point-in-time shares-outstanding figure. Used for per-share output; the model
   * holds it constant (no forecasted buybacks/issuance). Label it as such in UI.
   */
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
  // Only POSITIVE bases are usable for a reverse DCF. A negative/absent TTM does
  // not block the panel if a positive normalized average exists (Phase 2 intent).
  if (ttm != null && ttm > 0) opts.push({ key: 'ttm', label: 'TTM', value: ttm, yearsUsed: 1 });

  const usable = usableFcfValues(profile);
  if (usable.length >= 2) {
    const n = Math.min(3, usable.length);
    const value = mean(usable.slice(0, n));
    if (value > 0) opts.push({ key: 'avg3', label: `3Y avg (${n} yr)`, value, yearsUsed: n });
  }
  if (usable.length >= 3) {
    const n = Math.min(5, usable.length);
    const value = mean(usable.slice(0, n));
    if (value > 0) opts.push({ key: 'avg5', label: `5Y avg (${n} yr)`, value, yearsUsed: n });
  }
  return opts;
}

/** Default base: TTM until ≥3 usable annual years exist, then the 3Y average. */
export function defaultFcfBaseKey(profile: ValuationProfile | null): FcfBaseKey {
  return usableFcfValues(profile).length >= 3 ? 'avg3' : 'ttm';
}

/**
 * Resolve the single effective FCF base shared by the reverse-DCF and scenario
 * panels. Returns null when there is no usable base (caller shows the "no base"
 * state). A user-typed customFcf overrides the selected preset, but only when it
 * is finite (blank/partial input falls back to the preset value). Falls back to
 * the first option when baseKey isn't present.
 */
export function resolveFcfBase(
  options: FcfBaseOption[],
  baseKey: FcfBaseKey,
  customFcf: number | null
): { option: FcfBaseOption; effectiveFcf: number } | null {
  if (options.length === 0) return null;
  const option = options.find((o) => o.key === baseKey) ?? options[0];
  const effectiveFcf = customFcf != null && Number.isFinite(customFcf) ? customFcf : option.value;
  return { option, effectiveFcf };
}

// --- Driver context (Phase 3) -----------------------------------------------

export interface Drivers {
  /** Revenue CAGR over the recent window, %/yr. */
  revenueCagr: number | null;
  /** Latest operating income / revenue, %. */
  operatingMargin: number | null;
  /** Latest free cash flow / revenue, %. */
  fcfMargin: number | null;
  /** Latest capex / revenue, %. */
  capexIntensity: number | null;
  /** Latest stock-based comp / revenue, %. */
  sbcPctRevenue: number | null;
  /** Diluted-share-count change over the window, % (+ = more shares). Raw delta. */
  shareCountChange: number | null;
  /** Years spanned by the revenue-CAGR window (revenue and share data can differ). */
  revenueWindowYears: number | null;
  /** Years spanned by the share-count-change window. */
  shareCountWindowYears: number | null;
}

// --- Data anomaly flags (Week 1) --------------------------------------------
// The tool's value depends on NOT letting bad/odd provider data look
// authoritative. These are neutral "verify this" flags, not quality judgments.

export interface FundamentalFlag {
  fiscalYear: number;
  field: 'revenue' | 'freeCashFlow' | 'sharesDiluted' | 'capex' | 'history';
  note: string;
}

export const ANOMALY_THRESHOLDS = {
  revenueYoYPct: 60, // |YoY revenue change| beyond this is worth a look
  sharesYoYPct: 25,  // large diluted-share jumps → split / big issuance
} as const;

/**
 * Neutral data-quality flags over the annual history: outsized revenue/share
 * moves, FCF sign flips, negative-FCF years, missing capex (FCF not derivable),
 * and gaps in the fiscal-year sequence. Pure; empty for null/short history.
 */
export function detectFundamentalFlags(profile: ValuationProfile | null): FundamentalFlag[] {
  const h = profile?.history ?? [];
  const flags: FundamentalFlag[] = [];
  for (let i = 0; i < h.length; i++) {
    const y = h[i];
    if (y.capex == null && y.operatingCashFlow != null) {
      flags.push({ fiscalYear: y.fiscalYear, field: 'capex', note: 'Capex not reported — free cash flow not derivable this year.' });
    }
    if (y.freeCashFlow != null && y.freeCashFlow < 0) {
      flags.push({ fiscalYear: y.fiscalYear, field: 'freeCashFlow', note: 'Negative free cash flow — pulls down any normalized base that includes this year.' });
    }
    if (i === 0) continue;
    const p = h[i - 1];
    if (y.revenue != null && p.revenue != null && p.revenue !== 0) {
      const chg = ((y.revenue - p.revenue) / Math.abs(p.revenue)) * 100;
      if (Math.abs(chg) > ANOMALY_THRESHOLDS.revenueYoYPct) {
        flags.push({ fiscalYear: y.fiscalYear, field: 'revenue', note: `Revenue ${chg > 0 ? 'jumped' : 'dropped'} ${chg.toFixed(0)}% YoY — verify (restatement, M&A, or provider artifact).` });
      }
    }
    if (y.sharesDiluted != null && p.sharesDiluted != null && p.sharesDiluted !== 0) {
      const chg = ((y.sharesDiluted - p.sharesDiluted) / Math.abs(p.sharesDiluted)) * 100;
      if (Math.abs(chg) > ANOMALY_THRESHOLDS.sharesYoYPct) {
        flags.push({ fiscalYear: y.fiscalYear, field: 'sharesDiluted', note: `Diluted shares changed ${chg > 0 ? '+' : ''}${chg.toFixed(0)}% YoY — possible split or large issuance; per-share history may not be comparable.` });
      }
    }
    if (y.freeCashFlow != null && p.freeCashFlow != null && (y.freeCashFlow < 0) !== (p.freeCashFlow < 0)) {
      flags.push({ fiscalYear: y.fiscalYear, field: 'freeCashFlow', note: 'Free cash flow changed sign YoY — lumpy; a single-year base is unreliable.' });
    }
    if (y.fiscalYear - p.fiscalYear > 1) {
      flags.push({ fiscalYear: y.fiscalYear, field: 'history', note: `Gap in annual history (${p.fiscalYear} → ${y.fiscalYear}).` });
    }
  }
  return flags;
}

/** Most recent ≤maxYears fiscal years of history. */
function recentWindow(history: ValuationYear[], maxYears = 5): ValuationYear[] {
  if (history.length === 0) return [];
  const latestYear = history[history.length - 1].fiscalYear;
  return history.filter((y) => y.fiscalYear > latestYear - maxYears);
}

/** Newest year with both numerator and denominator present (den ≠ 0) → num/den %. */
function latestRatioPct(
  history: ValuationYear[],
  num: (y: ValuationYear) => number | null,
  den: (y: ValuationYear) => number | null
): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const n = num(history[i]);
    const d = den(history[i]);
    if (n != null && d != null && d !== 0) return (n / d) * 100;
  }
  return null;
}

/**
 * Neutral trailing drivers over a recent (≤5y) window. Each degrades to null
 * independently. Share-count change is deliberately a RAW delta over the window
 * (issuance / buybacks / SBC / splits / M&A combined) — never interpreted as
 * buybacks. A short window also limits split contamination.
 */
export function computeDrivers(profile: ValuationProfile | null): Drivers {
  const history = profile?.history ?? [];
  const win = recentWindow(history, 5);

  const rev = win.filter((y) => y.revenue != null && (y.revenue as number) > 0);
  let revenueCagr: number | null = null;
  let revenueWindowYears: number | null = null;
  if (rev.length >= 2) {
    const a = rev[0];
    const b = rev[rev.length - 1];
    const span = b.fiscalYear - a.fiscalYear;
    if (span >= 1) {
      revenueCagr = ((b.revenue! / a.revenue!) ** (1 / span) - 1) * 100;
      revenueWindowYears = span;
    }
  }

  // Revenue and share data can cover different usable years — track spans separately.
  const sh = win.filter((y) => y.sharesDiluted != null && (y.sharesDiluted as number) > 0);
  let shareCountChange: number | null = null;
  let shareCountWindowYears: number | null = null;
  if (sh.length >= 2) {
    const a = sh[0];
    const b = sh[sh.length - 1];
    shareCountChange = ((b.sharesDiluted! - a.sharesDiluted!) / a.sharesDiluted!) * 100;
    shareCountWindowYears = b.fiscalYear - a.fiscalYear;
  }

  return {
    revenueCagr,
    operatingMargin: latestRatioPct(history, (y) => y.operatingIncome, (y) => y.revenue),
    fcfMargin: latestRatioPct(history, (y) => y.freeCashFlow, (y) => y.revenue),
    capexIntensity: latestRatioPct(history, (y) => y.capex, (y) => y.revenue),
    sbcPctRevenue: latestRatioPct(history, (y) => y.stockBasedCompensation, (y) => y.revenue),
    shareCountChange,
    revenueWindowYears,
    shareCountWindowYears,
  };
}
