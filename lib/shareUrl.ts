import { EMPTY_FILTERS, type FilterCriteria } from './filters';

// Market cap is shared in billions to keep the URL short; everything else is
// shared in its native unit. The URL contains ONLY tickers and filter settings —
// never API keys, cached responses, or any other sensitive data.
const BILLION = 1_000_000_000;

export interface ShareState {
  tickers: string[];
  filters: FilterCriteria;
}

function numParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function serializeShare(tickers: string[], f: FilterCriteria): string {
  const p = new URLSearchParams();
  if (tickers.length > 0) p.set('t', tickers.join(','));
  if (f.industry) p.set('ind', f.industry);
  if (f.marketCapMin != null) p.set('mcmin', String(f.marketCapMin / BILLION));
  if (f.marketCapMax != null) p.set('mcmax', String(f.marketCapMax / BILLION));
  if (f.peMin != null) p.set('pemin', String(f.peMin));
  if (f.peMax != null) p.set('pemax', String(f.peMax));
  if (f.dividendYieldMin != null) p.set('dymin', String(f.dividendYieldMin));
  if (f.rangePositionMin != null) p.set('rpmin', String(f.rangePositionMin));
  if (f.rangePositionMax != null) p.set('rpmax', String(f.rangePositionMax));
  if (f.includeUnavailable) p.set('inc', '1');
  return p.toString();
}

export function parseShare(params: URLSearchParams): ShareState {
  const t = params.get('t');
  const tickers = t
    ? t.split(',').map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0)
    : [];

  const mcmin = numParam(params, 'mcmin');
  const mcmax = numParam(params, 'mcmax');

  const filters: FilterCriteria = {
    ...EMPTY_FILTERS,
    industry: params.get('ind') || null,
    marketCapMin: mcmin == null ? null : mcmin * BILLION,
    marketCapMax: mcmax == null ? null : mcmax * BILLION,
    peMin: numParam(params, 'pemin'),
    peMax: numParam(params, 'pemax'),
    dividendYieldMin: numParam(params, 'dymin'),
    rangePositionMin: numParam(params, 'rpmin'),
    rangePositionMax: numParam(params, 'rpmax'),
    includeUnavailable: params.get('inc') === '1'
  };

  return { tickers, filters };
}
