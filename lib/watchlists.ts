// Pure data model + serialization for saved watchlists. No DOM/localStorage here
// so it is fully unit-testable; the React hook (useWatchlists) owns persistence.

export interface Watchlist {
  id: string;
  name: string;
  tickers: string[];
}

export const STORAGE_KEY = 'stock-scanner.watchlists.v1';
const VERSION = 1;

function dedupeUpper(tickers: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tickers) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toUpperCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function serialize(watchlists: Watchlist[]): string {
  return JSON.stringify({ version: VERSION, watchlists });
}

function isWatchlistLike(x: unknown): x is { id: unknown; name: unknown; tickers: unknown } {
  return !!x && typeof x === 'object' && 'id' in x && 'name' in x && 'tickers' in x;
}

/**
 * Parse stored JSON into watchlists. Never throws. Tolerates corrupt JSON, an
 * outdated/loose shape (bare array or wrong version), and malformed entries —
 * invalid items are dropped, ticker order is preserved, and tickers are
 * normalized to uppercase + de-duplicated.
 */
export function parseStored(raw: string | null | undefined): Watchlist[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  let arr: unknown;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    arr = (parsed as Record<string, unknown>).watchlists;
  }
  if (!Array.isArray(arr)) return [];

  const out: Watchlist[] = [];
  for (const item of arr) {
    if (!isWatchlistLike(item)) continue;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    if (!Array.isArray(item.tickers)) continue;
    out.push({ id: item.id, name: item.name, tickers: dedupeUpper(item.tickers) });
  }
  return out;
}

let counter = 0;
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  counter += 1;
  return `wl_${Date.now()}_${counter}`;
}

export function createWatchlist(
  list: Watchlist[],
  name: string,
  tickers: string[] = [],
  id: string = genId()
): Watchlist[] {
  return [...list, { id, name: name.trim() || 'Untitled', tickers: dedupeUpper(tickers) }];
}

export function renameWatchlist(list: Watchlist[], id: string, name: string): Watchlist[] {
  const trimmed = name.trim();
  return list.map((w) => (w.id === id ? { ...w, name: trimmed || w.name } : w));
}

export function deleteWatchlist(list: Watchlist[], id: string): Watchlist[] {
  return list.filter((w) => w.id !== id);
}

export function addTicker(list: Watchlist[], id: string, ticker: string): Watchlist[] {
  return list.map((w) => (w.id === id ? { ...w, tickers: dedupeUpper([...w.tickers, ticker]) } : w));
}

export function removeTicker(list: Watchlist[], id: string, ticker: string): Watchlist[] {
  const target = ticker.trim().toUpperCase();
  return list.map((w) => (w.id === id ? { ...w, tickers: w.tickers.filter((t) => t !== target) } : w));
}

export function findWatchlist(list: Watchlist[], id: string | null): Watchlist | null {
  if (!id) return null;
  return list.find((w) => w.id === id) ?? null;
}
