import type { ScanRow } from './types';

/**
 * Currency/peer comparability guards (P1-D / P1-03 / P1-08).
 *
 * Product decision (roadmap decision log): no FX normalization yet — the
 * conservative default is to DETECT incomparability and suppress/warn instead
 * of silently aggregating. Monetary values (market cap) across different or
 * unknown currencies are never aggregated or presented as directly rankable;
 * percentages and ratios (growth, margins, EV/EBITDA, yields) are
 * currency-independent and stay comparable.
 */

type CurrencyRow = Pick<ScanRow, 'currency'>;

/** Distinct known currencies across rows (nulls excluded). */
export function distinctCurrencies(rows: CurrencyRow[]): string[] {
  return [...new Set(rows.map((r) => r.currency).filter((c): c is string => c != null))];
}

/**
 * True when monetary values across these rows cannot be compared numerically:
 * more than one known currency, or any row with an unknown currency alongside
 * others (unknown must be treated as potentially different — conservative).
 */
export function mixedCurrency(rows: CurrencyRow[]): boolean {
  if (rows.length < 2) return false;
  const known = distinctCurrencies(rows);
  if (known.length > 1) return true;
  const unknownCount = rows.filter((r) => r.currency == null).length;
  return unknownCount > 0;
}

export interface ComparabilityWarning {
  kind: 'mixed-currency' | 'mixed-industry';
  message: string;
}

/** Peer-set checks: currency and (when available) industry alignment. */
export function peerComparabilityWarnings(selected: ScanRow, peers: ScanRow[]): ComparabilityWarning[] {
  const all = [selected, ...peers];
  const warnings: ComparabilityWarning[] = [];

  if (mixedCurrency(all)) {
    const list = distinctCurrencies(all);
    const unknown = all.some((r) => r.currency == null);
    warnings.push({
      kind: 'mixed-currency',
      message: `This set spans ${list.length > 1 ? `multiple currencies (${list.join(', ')})` : 'known and unknown currencies'}${unknown && list.length > 1 ? ' plus an unknown currency' : ''} — the market-cap median is suppressed. Growth, margins, and multiples are currency-independent and remain comparable.`
    });
  }

  const industries = [...new Set(all.map((r) => r.industry).filter((i): i is string => i != null))];
  if (industries.length > 1) {
    warnings.push({
      kind: 'mixed-industry',
      message: `Peers span ${industries.length} industries (${industries.join(', ')}) — medians blend different business models; compare within an industry where possible.`
    });
  }

  return warnings;
}
