import type { ScanRow } from './types';
import { formatMarketCap, formatPercent } from './format';

// All numeric thresholds are in the SAME units as the underlying field:
//   marketCap*       -> raw currency units (the UI converts $B input to raw)
//   pe*              -> unitless P/E
//   dividendYieldMin -> percent (e.g. 2 means 2%)
//   rangePosition*   -> 0..1 fraction of the 52-week range
export interface FilterCriteria {
  industry: string | null;
  marketCapMin: number | null;
  marketCapMax: number | null;
  peMin: number | null;
  peMax: number | null;
  dividendYieldMin: number | null;
  rangePositionMin: number | null;
  rangePositionMax: number | null;
  /** When true, rows with a missing value pass an otherwise-active filter instead of failing it. */
  includeUnavailable: boolean;
}

export type FilterKey = Exclude<keyof FilterCriteria, 'includeUnavailable'>;

export const EMPTY_FILTERS: FilterCriteria = {
  industry: null,
  marketCapMin: null,
  marketCapMax: null,
  peMin: null,
  peMax: null,
  dividendYieldMin: null,
  rangePositionMin: null,
  rangePositionMax: null,
  includeUnavailable: false
};

function isMissing(value: number | null | undefined): boolean {
  return value == null || !Number.isFinite(value);
}

// A null threshold means the filter is inactive (matches everything). A missing
// row value fails an active filter unless includeUnavailable is set. A real 0 is
// a value, not "missing", so it is compared normally.
function passMin(value: number | null | undefined, min: number | null, includeUnavailable: boolean): boolean {
  if (min == null) return true;
  if (isMissing(value)) return includeUnavailable;
  return (value as number) >= min;
}

function passMax(value: number | null | undefined, max: number | null, includeUnavailable: boolean): boolean {
  if (max == null) return true;
  if (isMissing(value)) return includeUnavailable;
  return (value as number) <= max;
}

function passIndustry(value: string | null, industry: string | null, includeUnavailable: boolean): boolean {
  if (!industry) return true;
  if (value == null || value.trim() === '') return includeUnavailable;
  return value === industry;
}

export function rowMatches(row: ScanRow, c: FilterCriteria): boolean {
  return (
    passIndustry(row.industry, c.industry, c.includeUnavailable) &&
    passMin(row.marketCap, c.marketCapMin, c.includeUnavailable) &&
    passMax(row.marketCap, c.marketCapMax, c.includeUnavailable) &&
    passMin(row.trailingPE, c.peMin, c.includeUnavailable) &&
    passMax(row.trailingPE, c.peMax, c.includeUnavailable) &&
    passMin(row.dividendYieldPercent, c.dividendYieldMin, c.includeUnavailable) &&
    passMin(row.rangePosition, c.rangePositionMin, c.includeUnavailable) &&
    passMax(row.rangePosition, c.rangePositionMax, c.includeUnavailable)
  );
}

/** Filter rows, preserving input order. Pure — no provider calls. */
export function applyFilters(rows: ScanRow[], c: FilterCriteria): ScanRow[] {
  return rows.filter((row) => rowMatches(row, c));
}

/** Distinct, non-empty industries present in the rows, alphabetically sorted. */
export function distinctIndustries(rows: ScanRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.industry && row.industry.trim() !== '') set.add(row.industry);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function activeFilterCount(c: FilterCriteria): number {
  return (Object.keys(c) as (keyof FilterCriteria)[]).filter(
    (k) => k !== 'includeUnavailable' && c[k] != null
  ).length;
}

export function hasActiveFilters(c: FilterCriteria): boolean {
  return activeFilterCount(c) > 0;
}

export interface ActiveFilterChip {
  key: FilterKey;
  label: string;
}

/** Human-readable chips describing each active filter, for display + per-chip clearing. */
export function describeActiveFilters(c: FilterCriteria): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (c.industry) chips.push({ key: 'industry', label: `Industry: ${c.industry}` });
  if (c.marketCapMin != null) chips.push({ key: 'marketCapMin', label: `Market cap ≥ ${formatMarketCap(c.marketCapMin)}` });
  if (c.marketCapMax != null) chips.push({ key: 'marketCapMax', label: `Market cap ≤ ${formatMarketCap(c.marketCapMax)}` });
  if (c.peMin != null) chips.push({ key: 'peMin', label: `P/E ≥ ${c.peMin}` });
  if (c.peMax != null) chips.push({ key: 'peMax', label: `P/E ≤ ${c.peMax}` });
  if (c.dividendYieldMin != null) chips.push({ key: 'dividendYieldMin', label: `Div yield ≥ ${formatPercent(c.dividendYieldMin)}` });
  if (c.rangePositionMin != null) chips.push({ key: 'rangePositionMin', label: `52W pos ≥ ${Math.round(c.rangePositionMin * 100)}%` });
  if (c.rangePositionMax != null) chips.push({ key: 'rangePositionMax', label: `52W pos ≤ ${Math.round(c.rangePositionMax * 100)}%` });
  return chips;
}

/** Return a copy of the criteria with one filter cleared. */
export function clearFilter(c: FilterCriteria, key: FilterKey): FilterCriteria {
  return { ...c, [key]: null };
}
