export const DEFAULT_MAX_TICKERS = 10;

// 1-10 chars, starts with a letter, allows digits, dot and hyphen (e.g. BRK.B, RDS-A).
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export interface ParseResult {
  /** Valid, uppercased, de-duplicated tickers in input order, capped at maxTickers. */
  valid: string[];
  /** Tokens that failed ticker syntax validation (de-duplicated). */
  invalid: string[];
  /** Count of duplicate valid tickers that were removed. */
  duplicatesRemoved: number;
  /** True when more valid tickers were provided than maxTickers allows. */
  limited: boolean;
}

/**
 * Parse a freeform watchlist string. Accepts tickers separated by commas,
 * spaces, tabs or newlines. Normalizes to uppercase, removes duplicates while
 * preserving first-seen order, and enforces a maximum count.
 */
export function parseTickers(input: string, maxTickers = DEFAULT_MAX_TICKERS): ParseResult {
  const tokens = (input ?? '')
    .split(/[\s,]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicatesRemoved = 0;

  for (const token of tokens) {
    if (!TICKER_RE.test(token)) {
      if (!invalid.includes(token)) invalid.push(token);
      continue;
    }
    if (seen.has(token)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(token);
    valid.push(token);
  }

  return {
    valid: valid.slice(0, maxTickers),
    invalid,
    duplicatesRemoved,
    limited: valid.length > maxTickers
  };
}
