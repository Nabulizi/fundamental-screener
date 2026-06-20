'use client';

import type { ScanRow } from '@/lib/types';
import {
  type FilterCriteria,
  describeActiveFilters,
  distinctIndustries,
  hasActiveFilters,
  clearFilter,
  type FilterKey
} from '@/lib/filters';

interface Props {
  rows: ScanRow[];
  matchCount: number;
  criteria: FilterCriteria;
  onChange: (next: FilterCriteria) => void;
  onReset: () => void;
}

function parseNum(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const BILLION = 1_000_000_000;

export default function FilterPanel({ rows, matchCount, criteria, onChange, onReset }: Props) {
  const industries = distinctIndustries(rows);
  const chips = describeActiveFilters(criteria);
  const active = hasActiveFilters(criteria);
  // The 52-week position controls only make sense when current-price data exists.
  const showRangePosition = rows.some((r) => r.rangePosition != null);

  function set<K extends keyof FilterCriteria>(key: K, value: FilterCriteria[K]) {
    onChange({ ...criteria, [key]: value });
  }

  const capB = (raw: number | null) => (raw == null ? '' : String(raw / BILLION));
  const setCap = (key: 'marketCapMin' | 'marketCapMax', v: string) => {
    const n = parseNum(v);
    set(key, n == null ? null : n * BILLION);
  };

  return (
    <fieldset className="filters">
      <legend>Filters</legend>

      <div className="filter-grid">
        <label className="field">
          <span>Industry</span>
          <select value={criteria.industry ?? ''} onChange={(e) => set('industry', e.target.value || null)}>
            <option value="">Any</option>
            {industries.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </label>

        <div className="field range">
          <span>Market cap ($B)</span>
          <div className="range-inputs">
            <input type="number" inputMode="decimal" min="0" placeholder="min" aria-label="Minimum market cap in billions" value={capB(criteria.marketCapMin)} onChange={(e) => setCap('marketCapMin', e.target.value)} />
            <span aria-hidden="true">–</span>
            <input type="number" inputMode="decimal" min="0" placeholder="max" aria-label="Maximum market cap in billions" value={capB(criteria.marketCapMax)} onChange={(e) => setCap('marketCapMax', e.target.value)} />
          </div>
        </div>

        <div className="field range">
          <span>Trailing P/E</span>
          <div className="range-inputs">
            <input type="number" inputMode="decimal" placeholder="min" aria-label="Minimum P/E" value={criteria.peMin ?? ''} onChange={(e) => set('peMin', parseNum(e.target.value))} />
            <span aria-hidden="true">–</span>
            <input type="number" inputMode="decimal" placeholder="max" aria-label="Maximum P/E" value={criteria.peMax ?? ''} onChange={(e) => set('peMax', parseNum(e.target.value))} />
          </div>
        </div>

        <label className="field">
          <span>Min dividend yield (%)</span>
          <input type="number" inputMode="decimal" min="0" placeholder="e.g. 2" value={criteria.dividendYieldMin ?? ''} onChange={(e) => set('dividendYieldMin', parseNum(e.target.value))} />
        </label>

        {showRangePosition && (
          <div className="field range">
            <span>52W position (%)</span>
            <div className="range-inputs">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                placeholder="min"
                aria-label="Minimum 52-week range position percent"
                value={criteria.rangePositionMin == null ? '' : String(Math.round(criteria.rangePositionMin * 100))}
                onChange={(e) => {
                  const n = parseNum(e.target.value);
                  set('rangePositionMin', n == null ? null : n / 100);
                }}
              />
              <span aria-hidden="true">–</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                placeholder="max"
                aria-label="Maximum 52-week range position percent"
                value={criteria.rangePositionMax == null ? '' : String(Math.round(criteria.rangePositionMax * 100))}
                onChange={(e) => {
                  const n = parseNum(e.target.value);
                  set('rangePositionMax', n == null ? null : n / 100);
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="filter-footer">
        <label className="checkbox">
          <input type="checkbox" checked={criteria.includeUnavailable} onChange={(e) => set('includeUnavailable', e.target.checked)} />
          <span>Include stocks with unavailable values</span>
        </label>

        <div className="filter-count" aria-live="polite">
          Showing <strong>{matchCount}</strong> of {rows.length}
        </div>

        <button type="button" className="secondary" onClick={onReset} disabled={!active}>
          Reset filters
        </button>
      </div>

      {chips.length > 0 && (
        <ul className="active-filters" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key}>
              {chip.label}
              <button
                type="button"
                className="chip-clear"
                aria-label={`Clear filter: ${chip.label}`}
                onClick={() => onChange(clearFilter(criteria, chip.key as FilterKey))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
