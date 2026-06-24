export const NA = 'N/A';

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CAD: 'C$',
  AUD: 'A$',
  HKD: 'HK$',
  CHF: 'CHF '
};

function symbolFor(currency: string | null | undefined): string {
  if (!currency) return '$';
  return SYMBOLS[currency] ?? `${currency} `;
}

function isUsable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Format market cap with M / B / T suffixes. Null/non-finite -> "N/A". */
export function formatMarketCap(value: number | null, currency: string | null = 'USD'): string {
  if (!isUsable(value)) return NA;
  const sym = symbolFor(currency);
  const abs = Math.abs(value);
  let divisor = 1;
  let suffix = '';
  if (abs >= 1e12) {
    divisor = 1e12;
    suffix = 'T';
  } else if (abs >= 1e9) {
    divisor = 1e9;
    suffix = 'B';
  } else if (abs >= 1e6) {
    divisor = 1e6;
    suffix = 'M';
  } else if (abs >= 1e3) {
    divisor = 1e3;
    suffix = 'K';
  }
  return `${sym}${(value / divisor).toFixed(2)}${suffix}`;
}

/** Format a price as currency with two decimals. Null/non-finite -> "N/A". */
export function formatCurrency(value: number | null, currency: string | null = 'USD'): string {
  if (!isUsable(value)) return NA;
  const sym = symbolFor(currency);
  const body = value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${sym}${body}`;
}

/** Format a percentage value. 0 is preserved as "0.00%". Null/non-finite -> "N/A". */
export function formatPercent(value: number | null): string {
  if (!isUsable(value)) return NA;
  return `${value.toFixed(2)}%`;
}

/** Format a signed return (e.g. YTD). Positive gets "+", negative gets "−". Null -> "N/A". */
export function formatReturn(value: number | null): string {
  if (!isUsable(value)) return NA;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Format trailing P/E. Null / non-finite / non-positive -> "N/A". */
export function formatPe(value: number | null): string {
  if (!isUsable(value) || value <= 0) return NA;
  return value.toFixed(2);
}

/** Format a ratio (e.g. D/E, EV/EBITDA). Null / non-finite -> "N/A". */
export function formatRatio(value: number | null): string {
  if (!isUsable(value)) return NA;
  return value.toFixed(2);
}
