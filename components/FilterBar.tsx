'use client';

import type { ScanRow } from '@/lib/types';
import {
  type FilterCriteria, type FilterKey,
  describeActiveFilters, clearFilter, distinctIndustries, hasActiveFilters, EMPTY_FILTERS
} from '@/lib/filters';
import { MAX_STRENGTH, MAX_RISK } from '@/lib/scoring';

const BILLION = 1_000_000_000;

interface Props {
  rows: ScanRow[];
  filters: FilterCriteria;
  onChange: (filters: FilterCriteria) => void;
  /** Rows shown / rows scanned, for the "n of m match" line. */
  shown: number;
}

// Focused, evidence-aware filter set (P2-B): coverage/strength/risk plus a few
// metric narrowers. Filtering is display-only — it never re-fetches.
export default function FilterBar({ rows, filters, onChange, shown }: Props) {
  const industries = distinctIndustries(rows);
  const chips = describeActiveFilters(filters);

  const num = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const set = (patch: Partial<FilterCriteria>) => onChange({ ...filters, ...patch });

  return (
    <details className="filter-bar">
      <summary>
        Filters{chips.length > 0 ? ` (${chips.length} active — ${shown} of ${rows.length} shown)` : ''} ▾
      </summary>
      <div className="filter-grid">
        <label>
          Industry
          <select value={filters.industry ?? ''} onChange={(e) => set({ industry: e.target.value || null })}>
            <option value="">Any</option>
            {industries.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label>
          Strength ≥
          <input type="number" min={0} max={MAX_STRENGTH} value={filters.strengthMin ?? ''}
            onChange={(e) => set({ strengthMin: num(e.target.value) })} />
        </label>
        <label>
          Risk ≤
          <input type="number" min={0} max={MAX_RISK} value={filters.riskMax ?? ''}
            onChange={(e) => set({ riskMax: num(e.target.value) })} />
        </label>
        <label>
          Coverage ≥ %
          <input type="number" min={0} max={100} value={filters.coverageMin == null ? '' : Math.round(filters.coverageMin * 100)}
            onChange={(e) => { const n = num(e.target.value); set({ coverageMin: n == null ? null : n / 100 }); }} />
        </label>
        <label>
          Mkt cap ≥ $B
          <input type="number" min={0} value={filters.marketCapMin == null ? '' : filters.marketCapMin / BILLION}
            onChange={(e) => { const n = num(e.target.value); set({ marketCapMin: n == null ? null : n * BILLION }); }} />
        </label>
        <label>
          P/E ≤
          <input type="number" min={0} value={filters.peMax ?? ''}
            onChange={(e) => set({ peMax: num(e.target.value) })} />
        </label>
        <label>
          Div yield ≥ %
          <input type="number" min={0} step="0.1" value={filters.dividendYieldMin ?? ''}
            onChange={(e) => set({ dividendYieldMin: num(e.target.value) })} />
        </label>
        <label className="filter-check">
          <input type="checkbox" checked={filters.includeUnavailable}
            onChange={(e) => set({ includeUnavailable: e.target.checked })} />
          Keep rows with missing values
        </label>
      </div>
      {chips.length > 0 && (
        <div className="filter-chips">
          {chips.map((chip) => (
            <button key={chip.key} type="button" className="chip" onClick={() => onChange(clearFilter(filters, chip.key as FilterKey))} title="Clear this filter">
              {chip.label} ×
            </button>
          ))}
          {hasActiveFilters(filters) && (
            <button type="button" className="chip chip-clear-all" onClick={() => onChange({ ...EMPTY_FILTERS })}>
              Clear all
            </button>
          )}
        </div>
      )}
    </details>
  );
}
